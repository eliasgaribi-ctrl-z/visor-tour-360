import * as THREE from 'three'
import { DEG } from '../math'
import { crearLienzo, fovDe } from './frames'
import { PanoramaStitcher } from './stitcher'

/**
 * ============================================================================
 *  TRAER UNA FOTO QUE YA EXISTE
 * ============================================================================
 *
 * Tres orígenes, tres tratamientos:
 *
 *   1. Foto 360 completa (cámara Insta360, Ricoh Theta, "Photo Sphere"):
 *      ya es equirectangular 2:1. Solo se ajusta de tamaño.
 *
 *   2. Panorámica del celular (el modo Panorámica de iPhone o Android):
 *      es una tira muy ancha que cubre una parte del círculo. Se coloca en el
 *      lugar del lienzo que le corresponde y el resto queda vacío.
 *
 *   3. Foto normal: se proyecta como la vería la lente, apuntando al frente.
 *      Cubre poco, pero sirve para una habitación de la que solo hay una foto.
 *
 * En los casos 1 y 2, si la foto trae metadatos GPano —y las cámaras 360 y la
 * app de Google los traen— no hay que adivinar nada: dicen exactamente qué
 * pedazo de la esfera es esa imagen.
 */

export type TipoDeFoto = 'esfera' | 'panoramica' | 'foto'

export type GPano = {
  anchoTotal: number
  altoTotal: number
  ancho: number
  alto: number
  izquierda: number
  arriba: number
}

/**
 * Busca los metadatos GPano dentro del archivo.
 *
 * Van en un bloque XMP incrustado en el JPEG. En vez de armar un lector de
 * segmentos JPEG completo se busca el texto directamente en los primeros
 * kilobytes: el XMP siempre va al principio, justo después de la miniatura, y
 * el formato es XML plano.
 */
export async function leerGPano(file: Blob): Promise<GPano | null> {
  try {
    const trozo = await file.slice(0, 512 * 1024).arrayBuffer()
    const texto = new TextDecoder('latin1').decode(new Uint8Array(trozo))
    if (!texto.includes('GPano:')) return null

    const numero = (campo: string): number | null => {
      // Los escritores usan atributo (GPano:Campo="123") o etiqueta.
      const attr = new RegExp(`GPano:${campo}\\s*=\\s*"(-?\\d+)"`).exec(texto)
      if (attr) return Number(attr[1])
      const tag = new RegExp(`<GPano:${campo}>\\s*(-?\\d+)\\s*</GPano:${campo}>`).exec(texto)
      return tag ? Number(tag[1]) : null
    }

    const anchoTotal = numero('FullPanoWidthPixels')
    const altoTotal = numero('FullPanoHeightPixels')
    const ancho = numero('CroppedAreaImageWidthPixels')
    const alto = numero('CroppedAreaImageHeightPixels')
    const izquierda = numero('CroppedAreaLeftPixels') ?? 0
    const arriba = numero('CroppedAreaTopPixels') ?? 0

    if (!anchoTotal || !altoTotal || !ancho || !alto) return null
    return { anchoTotal, altoTotal, ancho, alto, izquierda, arriba }
  } catch {
    return null
  }
}

export class ImportError extends Error {
  consejo?: string
  constructor(message: string, consejo?: string) {
    super(message)
    this.name = 'ImportError'
    this.consejo = consejo
  }
}

/**
 * Decodifica el archivo a un canvas, ya girado según su EXIF.
 *
 * `imageOrientation: 'from-image'` es lo que evita que una foto tomada con el
 * teléfono de lado entre acostada: sin eso, el navegador entrega los píxeles
 * crudos del sensor y la rotación se queda solo en los metadatos.
 */
export async function leerImagen(file: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (error) {
    const tipo = (file as File).type || ''
    if (/heic|heif/i.test(tipo) || /heic|heif$/i.test((file as File).name ?? '')) {
      throw new ImportError(
        'Esta foto está en formato HEIC y el navegador no puede abrirla.',
        'En el iPhone: Ajustes → Cámara → Formatos → “Más compatible”. O comparte la foto por WhatsApp o correo, que la convierte a JPG.',
      )
    }
    throw new ImportError(
      'No se pudo abrir la imagen.',
      error instanceof Error ? error.message : undefined,
    )
  }

  const canvas = crearLienzo(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new ImportError('No se pudo preparar la imagen.')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}

/** Qué parece ser la foto, para preseleccionar la opción correcta. */
export function adivinarTipo(width: number, height: number, gpano: GPano | null): TipoDeFoto {
  if (gpano) {
    const completa =
      gpano.ancho >= gpano.anchoTotal * 0.98 && gpano.alto >= gpano.altoTotal * 0.98
    return completa ? 'esfera' : 'panoramica'
  }
  const proporcion = width / height
  if (proporcion > 1.85 && proporcion < 2.15) return 'esfera'
  if (proporcion >= 2.15) return 'panoramica'
  return 'foto'
}

export type ColocacionOpciones = {
  tipo: TipoDeFoto
  gpano?: GPano | null
  /** Ancho del lienzo equirectangular resultante. */
  anchoDestino?: number
  /** Grados de círculo que abarca una panorámica (cuando no hay GPano). */
  coberturaDeg?: number
  /** Campo de visión del lado largo, para una foto normal. */
  fovDeg?: number
  /** Hacia dónde queda el centro de la foto. */
  yaw?: number
  pitch?: number
  colorVacio?: string
}

const VACIO_POR_DEFECTO = '#11161f'

/**
 * Coloca la foto dentro de un lienzo equirectangular 2:1.
 *
 * Los casos 'esfera' y 'panoramica' se resuelven con un simple `drawImage`: en
 * una equirectangular, la posición horizontal es proporcional al yaw y la
 * vertical al pitch, así que colocar la imagen es escalarla y moverla, sin
 * deformación. El caso 'foto' sí necesita proyección de verdad y para eso se
 * reutiliza el mismo costurero de la captura con la cámara.
 */
export async function aEquirectangular(
  fuente: HTMLCanvasElement,
  opciones: ColocacionOpciones,
): Promise<HTMLCanvasElement> {
  const anchoDestino = opciones.anchoDestino ?? Math.min(4096, Math.max(2048, fuente.width))
  const altoDestino = Math.round(anchoDestino / 2)

  if (opciones.tipo === 'foto') {
    return proyectarFotoNormal(fuente, anchoDestino, opciones)
  }

  const canvas = crearLienzo(anchoDestino, altoDestino)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new ImportError('No se pudo preparar el lienzo.')
  ctx.fillStyle = opciones.colorVacio ?? VACIO_POR_DEFECTO
  ctx.fillRect(0, 0, anchoDestino, altoDestino)
  ctx.imageSmoothingQuality = 'high'

  const gpano = opciones.gpano
  if (gpano) {
    // Los metadatos dicen exactamente qué pedazo de la esfera es la imagen.
    const escala = anchoDestino / gpano.anchoTotal
    ctx.drawImage(
      fuente,
      gpano.izquierda * escala,
      gpano.arriba * escala,
      gpano.ancho * escala,
      gpano.alto * escala,
    )
    return canvas
  }

  if (opciones.tipo === 'esfera') {
    ctx.drawImage(fuente, 0, 0, anchoDestino, altoDestino)
    return canvas
  }

  /* Panorámica del celular: es una proyección CILÍNDRICA, no equirectangular.
     La diferencia está en el eje vertical: en una cilíndrica la altura crece
     con la tangente del pitch, así que el techo y el piso salen estirados
     respecto a una equirectangular. Colocarla como si fuera equirectangular
     deja las puertas y los muebles ligeramente aplastados. */
  colocarCilindrica(ctx, fuente, {
    anchoDestino,
    altoDestino,
    coberturaDeg: Math.min(360, Math.max(30, opciones.coberturaDeg ?? 180)),
    yaw: opciones.yaw ?? 0,
    pitch: opciones.pitch ?? 0,
  })

  return canvas
}

/**
 * Reproyecta una panorámica cilíndrica sobre el lienzo equirectangular.
 *
 * En una cilíndrica:  x ∝ yaw   y   y ∝ tan(pitch)
 * En una equirectangular:  x ∝ yaw   y   y ∝ pitch
 *
 * O sea que el eje horizontal es el mismo estiramiento en las dos y solo hay
 * que arreglar el vertical. Y como cada renglón del destino corresponde a UN
 * pitch, cada renglón es un simple `drawImage` de una franja del origen: dos
 * mil llamadas resuelven todo el remapeo, con el filtrado del navegador
 * incluido, en vez de recorrer ocho millones de píxeles en JavaScript.
 */
function colocarCilindrica(
  ctx: CanvasRenderingContext2D,
  fuente: HTMLCanvasElement,
  opciones: {
    anchoDestino: number
    altoDestino: number
    coberturaDeg: number
    yaw: number
    pitch: number
  },
) {
  const { anchoDestino, altoDestino, coberturaDeg, yaw, pitch } = opciones

  // Distancia focal de la panorámica, en píxeles: el ancho completo abarca
  // exactamente la cobertura declarada.
  const focal = fuente.width / (coberturaDeg * DEG)
  const anchoColocado = (coberturaDeg / 360) * anchoDestino
  const x = (yaw / 360 + 0.5) * anchoDestino - anchoColocado / 2

  // Hasta dónde llega la imagen hacia arriba y hacia abajo.
  const pitchMaximo = Math.atan(fuente.height / 2 / focal) / DEG
  const filaDesde = Math.max(0, Math.floor(((90 - (pitch + pitchMaximo)) / 180) * altoDestino))
  const filaHasta = Math.min(altoDestino, Math.ceil(((90 - (pitch - pitchMaximo)) / 180) * altoDestino))

  const yDeFila = (fila: number) => {
    const pitchDeFila = (90 - (fila / altoDestino) * 180 - pitch) * DEG
    return fuente.height / 2 - focal * Math.tan(pitchDeFila)
  }

  for (let fila = filaDesde; fila < filaHasta; fila++) {
    const yArriba = yDeFila(fila)
    const yAbajo = yDeFila(fila + 1)
    const alto = Math.max(0.5, yAbajo - yArriba)
    if (yArriba + alto < 0 || yArriba > fuente.height) continue

    for (const desplazamiento of [0, -anchoDestino, anchoDestino]) {
      const destinoX = x + desplazamiento
      // Solo las copias que de verdad tocan el lienzo (la costura de 360°).
      if (destinoX > anchoDestino || destinoX + anchoColocado < 0) continue
      ctx.drawImage(
        fuente,
        0,
        yArriba,
        fuente.width,
        alto,
        destinoX,
        fila,
        anchoColocado,
        1.02, // un pelo más de 1 px: sin esto quedan renglones sin pintar
      )
    }
  }
}

/** Una foto normal, proyectada como la vería la lente desde el centro del cuarto. */
async function proyectarFotoNormal(
  fuente: HTMLCanvasElement,
  anchoDestino: number,
  opciones: ColocacionOpciones,
): Promise<HTMLCanvasElement> {
  const { hfov, vfov } = fovDe(fuente.width, fuente.height, opciones.fovDeg ?? 66)

  const stitcher = new PanoramaStitcher({
    width: anchoDestino,
    preview: { width: 64, height: 32 },
    colorVacio: new THREE.Color(opciones.colorVacio ?? VACIO_POR_DEFECTO).getHex(),
    // Una sola foto: sin desvanecido, para no perder el borde con un degradado
    // hacia el vacío. Cuando hay una sola toma no hay nada con qué mezclar.
    difuminado: 0.02,
  })

  try {
    const orientacion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((opciones.pitch ?? 0) * DEG, -(opciones.yaw ?? 0) * DEG, 0, 'YXZ'),
    )
    stitcher.agregar({ fuente, orientacion, hfov, vfov })

    const blob = await stitcher.exportar(0.95)
    const bitmap = await createImageBitmap(blob)
    const canvas = crearLienzo(bitmap.width, bitmap.height)
    canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0)
    bitmap.close()
    return canvas
  } finally {
    stitcher.dispose()
  }
}

/** Guarda el lienzo como JPEG. */
export async function aJpeg(canvas: HTMLCanvasElement, calidad = 0.86): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', calidad),
  )
  if (!blob) throw new ImportError('El navegador no pudo guardar la imagen.')
  return blob
}

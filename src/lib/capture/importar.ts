import * as THREE from 'three'
import { DEG } from '../math'
import { crearLienzo, fovDe } from './frames'
import { PanoramaStitcher } from './stitcher'
import { leerBytes } from '../store/bytes'

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
    // leerBytes y no .arrayBuffer(): ese método es de iOS 14 en adelante, y sin
    // esto los metadatos GPano se leían como ausentes en un iPhone viejo, o sea
    // que una foto 360 de verdad entraba como si fuera una foto normal.
    const trozo = await leerBytes(file.slice(0, 512 * 1024))
    const texto = new TextDecoder('latin1').decode(trozo)
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

    /* Los metadatos vienen de un archivo ajeno y son los que deciden dónde se
       dibuja la imagen sobre el lienzo. Un FullPanoWidthPixels de cero parte
       una división; uno negativo o disparatado manda el drawImage a
       coordenadas absurdas y el resultado es un lienzo en blanco sin ningún
       error en la consola. Si algo no cuadra se devuelve null y la foto entra
       por el camino de "adivinar el tipo", que es el que ya existía para las
       fotos sin metadatos. 200 000 píxeles de lado es más del doble de la
       panorámica más grande que produce cualquier cámara de consumo. */
    const sano = (v: number | null): v is number =>
      v !== null && Number.isFinite(v) && v > 0 && v <= 200_000
    if (!sano(anchoTotal) || !sano(altoTotal) || !sano(ancho) || !sano(alto)) return null
    if (!Number.isFinite(izquierda) || !Number.isFinite(arriba)) return null
    if (izquierda < 0 || arriba < 0) return null
    if (ancho > anchoTotal || alto > altoTotal) return null
    if (izquierda + ancho > anchoTotal || arriba + alto > altoTotal) return null

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

/* ------------------------------------------------------ ABRIR EL ARCHIVO */

/**
 * El techo de píxeles del lienzo de ORIGEN.
 *
 * Safari en iOS aguanta 16 777 216 píxeles por canvas y, al pasarse, no lanza
 * ningún error: entrega el lienzo EN BLANCO. El lienzo de salida ya se protege
 * con `lienzoUtilizable` (ver frames.ts), pero este de entrada nunca pasó por
 * ahí, así que una foto de 50 megapíxeles —que hoy toma cualquier teléfono de
 * gama media— se guardaba como una habitación completamente vacía.
 *
 * Bajar de aquí no pierde nada: la equirectangular que se exporta es de
 * 4096×2048, o sea 8 megapíxeles, y de una foto normal se aprovecha todavía
 * menos.
 */
const MAX_PX_ORIGEN = 16_000_000

type FuenteDecodificada = {
  fuente: CanvasImageSource
  ancho: number
  alto: number
  /** ¿El decodificador ya aplicó la rotación del EXIF? `null` = no se sabe. */
  yaOrientada: boolean | null
  soltar: () => void
}

/**
 * Decodifica el archivo, bajando por tres escalones hasta que uno funcione.
 *
 * 1. `createImageBitmap` con `imageOrientation: 'from-image'`. Es el bueno: sin
 *    eso, una foto tomada con el teléfono de lado entra acostada, porque el
 *    navegador entrega los píxeles crudos del sensor y la rotación se queda
 *    solo en los metadatos.
 * 2. `createImageBitmap` sin opciones. `imageOrientation` es un enum de WebIDL,
 *    y en un WebKit cuyo enum solo tiene 'none' y 'flipY', pasarle
 *    'from-image' lanza TypeError ANTES de mirar la imagen. O sea que un JPEG
 *    perfectamente válido se reportaba como ilegible por culpa de una opción.
 * 3. Un `<img>` y `decode()`. Es lo que queda en los navegadores que ni
 *    siquiera tienen `createImageBitmap` (Safari lo trajo hasta iOS 15).
 */
async function decodificar(file: Blob): Promise<FuenteDecodificada> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        fuente: bitmap,
        ancho: bitmap.width,
        alto: bitmap.height,
        yaOrientada: true,
        soltar: () => bitmap.close(),
      }
    } catch {
      try {
        const bitmap = await createImageBitmap(file)
        return {
          fuente: bitmap,
          ancho: bitmap.width,
          alto: bitmap.height,
          yaOrientada: false,
          soltar: () => bitmap.close(),
        }
      } catch {
        // Los dos intentos con bitmap fallaron: queda el <img>.
      }
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return {
      fuente: img,
      ancho: img.naturalWidth,
      alto: img.naturalHeight,
      yaOrientada: null,
      // La URL se suelta hasta después de dibujar: revocarla antes deja a
      // algunos navegadores viejos con la imagen a medio pintar.
      soltar: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

/* ------------------------------------------------ LA ROTACIÓN DEL EXIF */

type ExifJpeg = {
  /** 1 a 8, según la tabla del EXIF. 1 = derecha, no hay nada que hacer. */
  orientacion: number
  /** El tamaño que declara el propio JPEG, SIN girar. 0 si no se encontró. */
  ancho: number
  alto: number
}

/**
 * Saca del JPEG la orientación del EXIF y su tamaño sin girar.
 *
 * No es un lector de EXIF completo: recorre los marcadores del principio del
 * archivo, saca la etiqueta 0x0112 del primer IFD y el tamaño del bloque SOF, y
 * se detiene ahí. Son unas cuarenta líneas contra los 40 KB de una librería,
 * para dos números.
 *
 * Los 256 KB de cabecera son de sobra: el EXIF va pegado al principio del
 * archivo y lo más grande que lleva dentro es la miniatura, que ronda los
 * 20 KB.
 */
async function leerExifJpeg(file: Blob): Promise<ExifJpeg | null> {
  try {
    const b = await leerBytes(file.slice(0, 256 * 1024))
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null // no es JPEG
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)

    let orientacion = 1
    let ancho = 0
    let alto = 0
    let p = 2

    while (p + 4 <= b.length) {
      if (b[p] !== 0xff) break
      const marcador = b[p + 1]
      // Marcadores sueltos: no traen bloque de datos detrás.
      if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd9)) {
        p += 2
        continue
      }
      // SOS: aquí empiezan los datos comprimidos y ya no hay cabeceras.
      if (marcador === 0xda) break

      const largo = dv.getUint16(p + 2)
      if (largo < 2) break
      const inicio = p + 4
      const fin = p + 2 + largo
      if (fin > b.length) break

      if (marcador === 0xe1) {
        orientacion = leerOrientacion(dv, b, inicio, fin) ?? orientacion
      }

      /* SOF0 a SOF15 llevan el tamaño real de la imagen. Los tres huecos de ese
         rango son otra cosa: DHT (0xc4), JPG (0xc8) y DAC (0xcc). El SOF va
         siempre después de los APPn, así que en cuanto aparece ya está todo
         lo que veníamos a buscar. */
      const esSof =
        marcador >= 0xc0 && marcador <= 0xcf &&
        marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc
      if (esSof) {
        if (inicio + 5 <= b.length) {
          alto = dv.getUint16(inicio + 1)
          ancho = dv.getUint16(inicio + 3)
        }
        break
      }

      p = fin
    }

    if (orientacion < 1 || orientacion > 8) orientacion = 1
    return { orientacion, ancho, alto }
  } catch {
    return null
  }
}

/** La etiqueta 0x0112 dentro de un bloque APP1 con EXIF. */
function leerOrientacion(dv: DataView, b: Uint8Array, inicio: number, fin: number): number | null {
  // El bloque tiene que empezar con "Exif\0\0"; si no, es otro APP1 (XMP, por
  // ejemplo, que es justo el que trae los GPano).
  if (fin - inicio < 14) return null
  if (b[inicio] !== 0x45 || b[inicio + 1] !== 0x78) return null
  if (b[inicio + 2] !== 0x69 || b[inicio + 3] !== 0x66) return null

  // Detrás viene una cabecera TIFF, que trae su propio orden de bytes.
  const tiff = inicio + 6
  const marca = dv.getUint16(tiff)
  if (marca !== 0x4949 && marca !== 0x4d4d) return null
  const le = marca === 0x4949
  if (dv.getUint16(tiff + 2, le) !== 0x002a) return null

  const ifd0 = tiff + dv.getUint32(tiff + 4, le)
  if (ifd0 < tiff || ifd0 + 2 > fin) return null

  const entradas = dv.getUint16(ifd0, le)
  for (let i = 0; i < entradas; i++) {
    const entrada = ifd0 + 2 + i * 12
    if (entrada + 12 > fin) break
    if (dv.getUint16(entrada, le) === 0x0112) return dv.getUint16(entrada + 8, le)
  }
  return null
}

/**
 * Qué rotación falta por aplicar a mano, si es que falta alguna.
 *
 * Girar de menos deja una foto acostada, que se arregla; girar DE MÁS arruina
 * una foto que estaba bien. Así que solo se gira cuando hay razón para creer
 * que el navegador no lo hizo.
 *
 * Cuando la orientación intercambia los ejes (de la 5 a la 8) eso se puede
 * comprobar de verdad: basta comparar el tamaño que entregó el decodificador
 * con el que el propio JPEG declara en su cabecera SOF. Si vienen
 * intercambiados, el navegador ya giró la imagen.
 *
 * Con las orientaciones 2, 3 y 4 —espejo y media vuelta— el tamaño no cambia y
 * no hay nada que comparar, así que se decide por el camino que se usó para
 * decodificar. Ver `decodificar` para el detalle de cada escalón.
 */
async function orientacionPendiente(
  file: Blob,
  yaOrientada: boolean | null,
  ancho: number,
  alto: number,
): Promise<number> {
  if (yaOrientada === true) return 1

  const exif = await leerExifJpeg(file)
  if (!exif || exif.orientacion === 1) return 1

  const medible = exif.ancho > 0 && exif.alto > 0 && exif.ancho !== exif.alto
  if (exif.orientacion >= 5 && medible) {
    const yaGirada = ancho === exif.alto && alto === exif.ancho
    return yaGirada ? 1 : exif.orientacion
  }

  /* `createImageBitmap` sin opciones solo se llega a usar en los navegadores
     cuyo enum viejo rechaza 'from-image', y en esos el valor por omisión es
     'none': seguro que no la giró. Con el <img> no se sabe —Chrome 81 y
     Safari 13.4 lo giran solos, los anteriores no— y ahí se deja como está. */
  return yaOrientada === false ? exif.orientacion : 1
}

/**
 * Prepara el lienzo para dibujar la imagen ya girada.
 *
 * `ancho` y `alto` son los de la imagen tal como la entregó el decodificador,
 * antes de girar. Cada matriz es la transformación que manda la esquina de
 * arriba a la izquierda del archivo a donde el EXIF dice que va.
 */
function aplicarOrientacion(
  ctx: CanvasRenderingContext2D,
  orientacion: number,
  ancho: number,
  alto: number,
) {
  switch (orientacion) {
    case 2: // espejo horizontal
      ctx.transform(-1, 0, 0, 1, ancho, 0)
      break
    case 3: // media vuelta
      ctx.transform(-1, 0, 0, -1, ancho, alto)
      break
    case 4: // espejo vertical
      ctx.transform(1, 0, 0, -1, 0, alto)
      break
    case 5: // espejo sobre la diagonal
      ctx.transform(0, 1, 1, 0, 0, 0)
      break
    case 6: // un cuarto de vuelta a la derecha
      ctx.transform(0, 1, -1, 0, alto, 0)
      break
    case 7: // espejo sobre la otra diagonal
      ctx.transform(0, -1, -1, 0, alto, ancho)
      break
    case 8: // un cuarto de vuelta a la izquierda
      ctx.transform(0, -1, 1, 0, 0, ancho)
      break
  }
}

/** Decodifica el archivo a un canvas, ya girado según su EXIF y sin pasarse de tamaño. */
export async function leerImagen(file: Blob): Promise<HTMLCanvasElement> {
  let decodificada: FuenteDecodificada
  try {
    decodificada = await decodificar(file)
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

  const { fuente, ancho: anchoOriginal, alto: altoOriginal, yaOrientada, soltar } = decodificada

  try {
    if (anchoOriginal <= 0 || altoOriginal <= 0) {
      throw new ImportError('El navegador abrió la imagen pero salió vacía.')
    }

    let ancho = anchoOriginal
    let alto = altoOriginal
    if (ancho * alto > MAX_PX_ORIGEN) {
      const factor = Math.sqrt(MAX_PX_ORIGEN / (ancho * alto))
      ancho = Math.max(1, Math.round(ancho * factor))
      alto = Math.max(1, Math.round(alto * factor))
    }

    const orientacion = await orientacionPendiente(file, yaOrientada, anchoOriginal, altoOriginal)
    // De la 5 a la 8 la foto queda de pie donde estaba acostada: el lienzo va al
    // revés que la imagen.
    const ejesCambiados = orientacion >= 5

    const canvas = crearLienzo(ejesCambiados ? alto : ancho, ejesCambiados ? ancho : alto)
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new ImportError('No se pudo preparar la imagen.')
    ctx.imageSmoothingQuality = 'high'
    if (orientacion > 1) aplicarOrientacion(ctx, orientacion, ancho, alto)
    ctx.drawImage(fuente, 0, 0, ancho, alto)
    return canvas
  } finally {
    soltar()
  }
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

/**
 * El proyector se REUTILIZA entre llamadas.
 *
 * La vista previa se rearma cada vez que el usuario mueve el deslizador del
 * campo de visión. Crear y destruir un contexto WebGL en cada movimiento es de
 * las pocas cosas que de verdad tumban un navegador de celular: los contextos
 * son caros de crear y hay un tope de cuántos pueden vivir a la vez; al pasarse,
 * el navegador empieza a matar los más viejos, incluido el del visor.
 */
let proyector: { stitcher: PanoramaStitcher; ancho: number } | null = null

/** Suelta el proyector compartido. Llamar al salir de la pantalla de importar. */
export function liberarProyector() {
  proyector?.stitcher.dispose()
  proyector = null
}

/** Una foto normal, proyectada como la vería la lente desde el centro del cuarto. */
async function proyectarFotoNormal(
  fuente: HTMLCanvasElement,
  anchoDestino: number,
  opciones: ColocacionOpciones,
): Promise<HTMLCanvasElement> {
  const { hfov, vfov } = fovDe(fuente.width, fuente.height, opciones.fovDeg ?? 66)

  if (proyector && proyector.ancho !== anchoDestino) liberarProyector()
  if (!proyector) {
    proyector = {
      ancho: anchoDestino,
      stitcher: new PanoramaStitcher({
        width: anchoDestino,
        preview: { width: 64, height: 32 },
        colorVacio: new THREE.Color(opciones.colorVacio ?? VACIO_POR_DEFECTO).getHex(),
        // Una sola foto: casi sin desvanecido, para no perder el borde con un
        // degradado hacia el vacío. No hay nada con qué mezclar.
        difuminado: 0.02,
      }),
    }
  }

  const { stitcher } = proyector
  stitcher.limpiar()

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
}

/** Guarda el lienzo como JPEG. */
export async function aJpeg(canvas: HTMLCanvasElement, calidad = 0.86): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', calidad),
  )
  if (!blob) throw new ImportError('El navegador no pudo guardar la imagen.')
  return blob
}

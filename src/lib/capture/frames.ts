import { DEG } from '../math'

/**
 * ============================================================================
 *  DE LA CÁMARA A UNA TOMA UTILIZABLE
 * ============================================================================
 *
 * Congelar el fotograma, medir su brillo y —lo más interesante— averiguar cuál
 * es el campo de visión real de la cámara de ESTE teléfono.
 */

/**
 * Campo de visión del LADO LARGO del fotograma, por defecto.
 *
 * Ningún navegador dice cuál es: `getSettings()` entrega resolución y cuadros
 * por segundo, y `getCapabilities()` no incluye nada de la lente. 66°
 * corresponde a un equivalente de 26 mm, que es lo que trae la cámara principal
 * de casi cualquier teléfono de los últimos años.
 *
 * Se define sobre el lado LARGO y no sobre el horizontal porque el fotograma
 * cambia de forma según cómo se sostenga el teléfono: en vertical, el lado
 * largo del sensor queda arriba-abajo y el campo ancho pasa a ser el vertical.
 *
 * Es un punto de partida: durante la captura se corrige solo con el giroscopio
 * (ver `estimarFovConGiro`).
 */
export const FOV_LADO_LARGO = 66

export type Fov = { hfov: number; vfov: number }

/** Campos horizontal y vertical de un fotograma, a partir de su forma. */
export function fovDe(width: number, height: number, fovLadoLargo = FOV_LADO_LARGO): Fov {
  const largo = Math.max(width, height)
  const corto = Math.min(width, height)
  const tanLargo = Math.tan((fovLadoLargo * DEG) / 2)
  const fovCorto = (2 * Math.atan(tanLargo * (corto / largo))) / DEG
  return width >= height
    ? { hfov: fovLadoLargo, vfov: fovCorto }
    : { hfov: fovCorto, vfov: fovLadoLargo }
}

/** Al revés: de un campo horizontal medido, el del lado largo. */
export function ladoLargoDesdeHorizontal(hfovDeg: number, width: number, height: number): number {
  if (width >= height) return hfovDeg
  const tanH = Math.tan((hfovDeg * DEG) / 2)
  return (2 * Math.atan(tanH * (height / width))) / DEG
}

export function crearLienzo(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** Libera un canvas grande. En iOS el presupuesto total de canvas es chico. */
export function soltarLienzo(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

/**
 * ¿Este navegador puede con un lienzo de este tamaño?
 *
 * Safari en iOS tiene un tope de 16 777 216 píxeles por canvas y un presupuesto
 * de memoria compartido entre todos los que estén vivos. Lo peligroso es que al
 * pasarse NO lanza ningún error: entrega el lienzo EN BLANCO. Sin esta prueba,
 * el recorrido se guardaría todo negro y no habría ni una línea en la consola
 * que lo explicara.
 *
 * La prueba es pintar un píxel y volver a leerlo.
 */
export function lienzoUtilizable(width: number, height: number): boolean {
  const canvas = crearLienzo(width, height)
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(width - 1, height - 1, 1, 1)
    const { data } = ctx.getImageData(width - 1, height - 1, 1, 1)
    return data[0] > 200 && data[1] < 60
  } catch {
    return false
  } finally {
    soltarLienzo(canvas)
  }
}

/** Tamaños de panorámica de mayor a menor. Se baja hasta que uno pase la prueba. */
export const ANCHOS_PANORAMICA = [4096, 3072, 2048, 1024]

/** El lienzo más grande que este teléfono aguanta de verdad. */
export function anchoUtilizable(maximo = 4096): number {
  for (const ancho of ANCHOS_PANORAMICA) {
    if (ancho > maximo) continue
    if (lienzoUtilizable(ancho, ancho / 2)) return ancho
  }
  return 1024
}

/**
 * Congela el fotograma actual del video en un canvas.
 *
 * Se limita el ancho porque no aporta nada tener tomas de 4000 px si la
 * panorámica final mide 4096 de circunferencia completa: cada toma cubre unos
 * 66°, o sea menos de la quinta parte del ancho final.
 */
export function capturarFotograma(video: HTMLVideoElement, anchoMaximo = 1600): HTMLCanvasElement {
  const escala = Math.min(1, anchoMaximo / (video.videoWidth || anchoMaximo))
  const width = Math.max(1, Math.round((video.videoWidth || anchoMaximo) * escala))
  const height = Math.max(1, Math.round((video.videoHeight || anchoMaximo) * escala))

  const canvas = crearLienzo(width, height)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('No se pudo preparar el lienzo de la toma.')
  ctx.drawImage(video, 0, 0, width, height)
  return canvas
}

/**
 * Brillo medio (0…1) de una imagen, para igualar la exposición entre tomas.
 * Se mide sobre una miniatura de 32×32: 1024 píxeles bastan para una media y
 * evitan leer millones desde la GPU.
 */
export function brilloDe(fuente: CanvasImageSource, muestra = 32): number {
  const canvas = crearLienzo(muestra, muestra)
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  if (!ctx) return 0.5
  ctx.drawImage(fuente, 0, 0, muestra, muestra)
  const { data } = ctx.getImageData(0, 0, muestra, muestra)

  let suma = 0
  for (let i = 0; i < data.length; i += 4) {
    // Luminancia perceptual (Rec. 709).
    suma += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  }
  return suma / (muestra * muestra * 255)
}

/** Versión en escala de grises y reducida, para comparar dos tomas. */
export function grisesReducidos(
  fuente: CanvasImageSource,
  width: number,
  height: number,
): Float32Array {
  const canvas = crearLienzo(width, height)
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  if (!ctx) return new Float32Array(width * height)
  ctx.drawImage(fuente, 0, 0, width, height)
  const { data } = ctx.getImageData(0, 0, width, height)

  const salida = new Float32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    salida[p] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
  }
  return salida
}

export type Desplazamiento = {
  /** Corrimiento horizontal en píxeles de la imagen reducida. */
  pixeles: number
  /** Qué tan confiable es (correlación normalizada, −1…1). */
  confianza: number
}

/**
 * Busca cuánto se corrió horizontalmente la imagen entre dos tomas.
 *
 * Correlación cruzada normalizada sobre una banda central de filas: se prueba
 * cada corrimiento y se queda con el que más se parece. La banda central se usa
 * porque el techo y el piso de un cuarto suelen ser lisos y no aportan nada
 * para alinear; la pared del medio sí tiene esquinas, cuadros y muebles.
 */
export function desplazamientoHorizontal(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  maximo = Math.floor(width * 0.6),
): Desplazamiento {
  const filaInicial = Math.floor(height * 0.25)
  const filaFinal = Math.ceil(height * 0.75)

  let mejor = 0
  let mejorPuntaje = -2

  for (let corrimiento = -maximo; corrimiento <= maximo; corrimiento++) {
    let sumaA = 0
    let sumaB = 0
    let sumaAA = 0
    let sumaBB = 0
    let sumaAB = 0
    let n = 0

    for (let fila = filaInicial; fila < filaFinal; fila++) {
      const base = fila * width
      const desde = Math.max(0, -corrimiento)
      const hasta = Math.min(width, width - corrimiento)
      for (let columna = desde; columna < hasta; columna++) {
        const va = a[base + columna]
        const vb = b[base + columna + corrimiento]
        sumaA += va
        sumaB += vb
        sumaAA += va * va
        sumaBB += vb * vb
        sumaAB += va * vb
        n++
      }
    }

    // Con muy poco traslape la correlación se vuelve ruido con puntaje alto.
    if (n < width * (filaFinal - filaInicial) * 0.25) continue

    const mediaA = sumaA / n
    const mediaB = sumaB / n
    const covarianza = sumaAB / n - mediaA * mediaB
    const varianzaA = sumaAA / n - mediaA * mediaA
    const varianzaB = sumaBB / n - mediaB * mediaB
    const denominador = Math.sqrt(Math.max(varianzaA, 1e-9) * Math.max(varianzaB, 1e-9))
    const puntaje = covarianza / denominador

    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje
      mejor = corrimiento
    }
  }

  return { pixeles: mejor, confianza: mejorPuntaje }
}

/**
 * ============================================================================
 *  CALIBRAR EL CAMPO DE VISIÓN CON EL GIROSCOPIO
 * ============================================================================
 *
 * Sabemos cuánto GIRÓ el teléfono entre dos tomas (los sensores lo dicen) y
 * podemos medir cuánto se CORRIÓ la imagen (correlación). Con esos dos datos
 * sale la distancia focal, y de ahí el campo de visión:
 *
 *   corrimiento_px = f · tan(Δángulo)      →      f = corrimiento_px / tan(Δángulo)
 *   hfov = 2 · atan( ancho / (2 · f) )
 *
 * Es la misma calibración que hace una cámara al medir un patrón conocido, solo
 * que aquí el patrón es el propio cuarto y la referencia la pone el giroscopio.
 *
 * Devuelve null si la medición no es confiable: pared lisa, giro demasiado
 * chico o resultado fuera de lo que cualquier teléfono puede tener.
 */
export function estimarFovConGiro(params: {
  anterior: Float32Array
  actual: Float32Array
  width: number
  height: number
  /** Cuánto giró el teléfono en horizontal entre las dos tomas, en grados. */
  deltaYaw: number
  /** Cuánto cambió la inclinación. Si es mucho, la medición no sirve. */
  deltaPitch: number
}): number | null {
  const { anterior, actual, width, height, deltaYaw, deltaPitch } = params

  // Giro chico: el corrimiento se confunde con el ruido. Giro enorme: casi no
  // hay traslape. Inclinación: el corrimiento ya no es solo horizontal.
  if (Math.abs(deltaYaw) < 8 || Math.abs(deltaYaw) > 55) return null
  if (Math.abs(deltaPitch) > 6) return null

  const { pixeles, confianza } = desplazamientoHorizontal(anterior, actual, width, height)
  if (confianza < 0.55 || pixeles === 0) return null

  // Un giro a la derecha mueve la imagen a la izquierda: los signos se cancelan.
  const focal = Math.abs(pixeles) / Math.tan(Math.abs(deltaYaw) * DEG)
  const hfov = (2 * Math.atan(width / (2 * focal))) / DEG

  // Ningún teléfono tiene una principal fuera de este rango; si sale de ahí,
  // la correlación se equivocó.
  if (hfov < 40 || hfov > 100) return null
  return hfov
}

/** Promedio robusto de varias estimaciones: la mediana aguanta un dato loco. */
export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const orden = [...valores].sort((a, b) => a - b)
  const medio = Math.floor(orden.length / 2)
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2
}

/** Reduce un canvas a un ancho máximo conservando la proporción. */
export function reducir(fuente: HTMLCanvasElement | HTMLImageElement, anchoMaximo: number) {
  const width = 'naturalWidth' in fuente ? fuente.naturalWidth : fuente.width
  const height = 'naturalHeight' in fuente ? fuente.naturalHeight : fuente.height
  if (width <= anchoMaximo) return fuente

  const escala = anchoMaximo / width
  const canvas = crearLienzo(Math.round(width * escala), Math.round(height * escala))
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return fuente
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(fuente, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Miniatura para la barra de habitaciones. */
export async function miniatura(
  fuente: HTMLCanvasElement | HTMLImageElement,
  ancho = 320,
  calidad = 0.72,
): Promise<Blob> {
  const width = 'naturalWidth' in fuente ? fuente.naturalWidth : fuente.width
  const height = 'naturalHeight' in fuente ? fuente.naturalHeight : fuente.height
  const alto = Math.max(1, Math.round((ancho * height) / width))

  const canvas = crearLienzo(ancho, alto)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('No se pudo generar la miniatura.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(fuente, 0, 0, ancho, alto)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', calidad),
  )
  if (!blob) throw new Error('No se pudo generar la miniatura.')
  return blob
}

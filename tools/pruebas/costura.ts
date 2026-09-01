/**
 * ============================================================================
 *  PRUEBA DE LA COSTURA  ·  se abre en /tools/pruebas/costura.html con npm run dev
 * ============================================================================
 *
 * La idea: si la costura está bien hecha, tiene que poder RECONSTRUIR una
 * panorámica que ya conocemos.
 *
 *   1. Se toma una equirectangular real (las de prueba de public/panoramas).
 *   2. Se simula la cámara del teléfono: para cada punto del plan de captura se
 *      recorta de esa panorámica lo que vería una cámara apuntando ahí. Esto es
 *      la proyección "de ida", escrita aparte y a mano.
 *   3. Esas tomas sintéticas se le dan al costurero, que hace la proyección
 *      "de vuelta" en la GPU.
 *   4. Se compara el resultado contra el original.
 *
 * Si un signo está invertido, si la costura de 360° no cierra, si los polos se
 * rompen o si la imagen sale volteada, la diferencia se dispara. Es una prueba
 * de extremo a extremo de toda la cadena de matemáticas.
 */
import * as THREE from 'three'
import { PanoramaStitcher } from '../../src/lib/capture/stitcher'
import { planDeCaptura } from '../../src/lib/capture/plan'
import { fovDe } from '../../src/lib/capture/frames'
import { DEG } from '../../src/lib/math'
import { asset } from '../../src/lib/assets'

const salida = document.getElementById('salida') as HTMLPreElement
const imagenes = document.getElementById('imagenes') as HTMLDivElement
const lineas: string[] = []

function log(texto: string) {
  lineas.push(texto)
  salida.innerHTML = lineas.join('\n')
  console.log(texto.replace(/<[^>]+>/g, ''))
}

function titulo(texto: string) {
  const h = document.createElement('h2')
  h.textContent = texto
  imagenes.append(h)
}

async function cargarImagen(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  return img
}

/** Pasa una imagen a un canvas para poder leer sus píxeles. */
function aLienzo(img: HTMLImageElement): { data: ImageData; width: number; height: number } {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height), width: canvas.width, height: canvas.height }
}

/**
 * LA PROYECCIÓN DE IDA, escrita a mano y sin usar nada del costurero.
 *
 * Simula lo que vería la cámara del teléfono apuntando en cierta dirección,
 * recortándolo de una panorámica equirectangular:
 *
 *   píxel de la foto → rayo de la lente → giro del teléfono → (yaw, pitch)
 *   → (u, v) de la equirectangular  con  u = yaw/360 + 0.5,  v = (90 − pitch)/180
 */
function simularToma(
  fuente: { data: ImageData; width: number; height: number },
  orientacion: THREE.Quaternion,
  hfov: number,
  vfov: number,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const destino = ctx.createImageData(width, height)

  const tanH = Math.tan((hfov * DEG) / 2)
  const tanV = Math.tan((vfov * DEG) / 2)
  const dir = new THREE.Vector3()
  const src = fuente.data.data

  for (let y = 0; y < height; y++) {
    // y = 0 es la fila de ARRIBA de la foto, o sea la parte de arriba de la escena.
    const sy = 1 - ((y + 0.5) / height) * 2
    for (let x = 0; x < width; x++) {
      const sx = ((x + 0.5) / width) * 2 - 1

      dir.set(sx * tanH, sy * tanV, -1).normalize().applyQuaternion(orientacion)

      const yaw = Math.atan2(dir.x, -dir.z) / DEG
      const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y))) / DEG

      const u = yaw / 360 + 0.5
      const v = (90 - pitch) / 180

      const px = Math.min(fuente.width - 1, Math.max(0, Math.round(u * fuente.width - 0.5)))
      const py = Math.min(fuente.height - 1, Math.max(0, Math.round(v * fuente.height - 0.5)))

      const i = (py * fuente.width + px) * 4
      const j = (y * width + x) * 4
      destino.data[j] = src[i]
      destino.data[j + 1] = src[i + 1]
      destino.data[j + 2] = src[i + 2]
      destino.data[j + 3] = 255
    }
  }

  ctx.putImageData(destino, 0, 0)
  return canvas
}

/** Diferencia media absoluta entre dos imágenes, en niveles de 0 a 255. */
function diferencia(a: ImageData, b: ImageData): { media: number; peor: number } {
  let suma = 0
  let peor = 0
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c] - b.data[i + c])
      suma += d
      if (d > peor) peor = d
      n++
    }
  }
  return { media: suma / n, peor }
}

function reescalar(fuente: CanvasImageSource, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(fuente, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

async function correr() {
  const original = await cargarImagen(asset('panoramas/sala.jpg'))
  log(`Panorámica original: ${original.naturalWidth}×${original.naturalHeight}`)
  const fuente = aLienzo(original)

  // Cámara simulada en vertical, como se sostiene un teléfono.
  const ANCHO_TOMA = 240
  const ALTO_TOMA = 426
  const { hfov, vfov } = fovDe(ANCHO_TOMA, ALTO_TOMA)
  log(`Cámara simulada: ${ANCHO_TOMA}×${ALTO_TOMA}, hfov ${hfov.toFixed(1)}° vfov ${vfov.toFixed(1)}°`)

  const puntos = planDeCaptura({ hfov, vfov, alcance: 'esfera' })
  log(`Plan de captura: ${puntos.length} tomas`)

  const stitcher = new PanoramaStitcher({ width: 2048, preview: { width: 640, height: 320 } })
  log(`Lienzo del costurero: ${stitcher.width}×${stitcher.height}`)

  const euler = new THREE.Euler()
  const quat = new THREE.Quaternion()

  const arranque = performance.now()
  for (const punto of puntos) {
    // Misma convención que el CameraRig: Euler YXZ, yaw negado.
    euler.set(punto.pitch * DEG, -punto.yaw * DEG, 0, 'YXZ')
    quat.setFromEuler(euler)

    const toma = simularToma(fuente, quat, hfov, vfov, ANCHO_TOMA, ALTO_TOMA)
    stitcher.agregar({ fuente: toma, orientacion: quat, hfov, vfov })
  }
  const tardanza = performance.now() - arranque
  log(`Cosidas ${puntos.length} tomas en ${tardanza.toFixed(0)} ms (${(tardanza / puntos.length).toFixed(1)} ms por toma)`)

  const cobertura = stitcher.cobertura()
  const coberturaOk = cobertura > 0.985
  log(`Cobertura de la esfera: <span class="${coberturaOk ? 'ok' : 'mal'}">${(cobertura * 100).toFixed(2)} %</span> (se espera > 98.5 %)`)

  const blob = await stitcher.exportar(0.95)
  log(`JPEG exportado: ${(blob.size / 1024).toFixed(0)} KB`)

  const reconstruida = await cargarImagen(URL.createObjectURL(blob))
  log(`Reconstruida: ${reconstruida.naturalWidth}×${reconstruida.naturalHeight}`)

  // Se comparan a baja resolución: lo que se busca son errores de geometría
  // (imagen volteada, corrida, espejeada), no la nitidez del remuestreo.
  const ANCHO = 512
  const ALTO = 256
  const a = reescalar(original, ANCHO, ALTO)
  const b = reescalar(reconstruida, ANCHO, ALTO)
  const { media, peor } = diferencia(a, b)
  const geometriaOk = media < 12
  log(`Diferencia media contra el original: <span class="${geometriaOk ? 'ok' : 'mal'}">${media.toFixed(2)} niveles</span> (se espera < 12); peor píxel ${peor}`)

  /* Una prueba puntual e independiente: la letra N de la panorámica de prueba
     está en yaw 0 y la E en yaw 90. Se comparan esas columnas. */
  const columna = (img: ImageData, yaw: number, pitch: number) => {
    const x = Math.round((yaw / 360 + 0.5) * ANCHO) % ANCHO
    const y = Math.round(((90 - pitch) / 180) * ALTO)
    const i = (Math.min(ALTO - 1, y) * ANCHO + Math.min(ANCHO - 1, x)) * 4
    return [img.data[i], img.data[i + 1], img.data[i + 2]]
  }
  for (const [yaw, pitch, nombre] of [[0, 22, 'N (frente)'], [90, 22, 'E (derecha)'], [180, 22, 'S (atrás)'], [-90, 22, 'O (izquierda)'], [0, 80, 'techo'], [0, -80, 'piso']] as const) {
    const ca = columna(a, yaw, pitch)
    const cb = columna(b, yaw, pitch)
    const d = Math.max(...ca.map((v, i) => Math.abs(v - cb[i])))
    log(`  ${nombre.padEnd(14)} yaw ${String(yaw).padStart(4)}° pitch ${String(pitch).padStart(3)}°  original rgb(${ca}) vs reconstruida rgb(${cb})  <span class="${d < 40 ? 'ok' : 'mal'}">Δ ${d}</span>`)
  }

  titulo('Original')
  imagenes.append(original)
  titulo('Reconstruida por el costurero')
  imagenes.append(reconstruida)
  titulo('Vista previa en vivo (canvas del costurero)')
  imagenes.append(stitcher.canvas)
  titulo('Una toma simulada')
  imagenes.append(simularToma(fuente, quat, hfov, vfov, ANCHO_TOMA, ALTO_TOMA))

  const todoBien = coberturaOk && geometriaOk
  log(`\n<span class="${todoBien ? 'ok' : 'mal'}">RESULTADO: ${todoBien ? 'TODO BIEN' : 'HAY ALGO MAL'}</span>`)
  ;(window as unknown as { PRUEBA_LISTA: boolean; PRUEBA_OK: boolean }).PRUEBA_LISTA = true
  ;(window as unknown as { PRUEBA_LISTA: boolean; PRUEBA_OK: boolean }).PRUEBA_OK = todoBien
}

correr().catch((error) => {
  log(`<span class="mal">EXPLOTÓ: ${error?.stack || error}</span>`)
  ;(window as unknown as { PRUEBA_LISTA: boolean; PRUEBA_OK: boolean }).PRUEBA_LISTA = true
  ;(window as unknown as { PRUEBA_LISTA: boolean; PRUEBA_OK: boolean }).PRUEBA_OK = false
})

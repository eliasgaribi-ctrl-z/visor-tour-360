/**
 * ============================================================================
 *  LA CÁMARA DEL TELÉFONO
 * ============================================================================
 *
 * Abrir la cámara trasera, mantenerla estable entre tomas y traducir cada error
 * del navegador a algo que una persona pueda entender y resolver.
 *
 * ── Lo que más confunde: el "contexto seguro" ──────────────────────────────
 * getUserMedia y los sensores de orientación SOLO funcionan en https o en
 * localhost. La URL "Network" que imprime `npm run dev` (http://192.168.x.x)
 * NO es contexto seguro: el visor carga, pero la cámara nunca va a abrir y el
 * navegador no siempre dice por qué. Por eso se detecta antes y se avisa.
 */

/**
 * Resolución objetivo: 1920×1440, o sea 4:3 y no 16:9.
 *
 * En casi cualquier teléfono, el modo 16:9 es un RECORTE del sensor 4:3: se
 * pierde como una cuarta parte del campo vertical sin ganar nada de campo
 * horizontal. Con el teléfono en vertical —que es como se sostiene para
 * fotografiar un cuarto— ese campo perdido es justo el que decide cuántas
 * vueltas de fotos hay que dar. Con 4:3 se pasa de cuatro anillos a tres.
 */
const IDEAL_WIDTH = 1920
const IDEAL_HEIGHT = 1440

export type CameraProblem =
  | 'inseguro'
  | 'no-soportado'
  | 'permiso'
  | 'sin-camara'
  | 'ocupada'
  | 'imposible'
  | 'desconocido'

export class CameraError extends Error {
  problem: CameraProblem
  detail?: string

  constructor(problem: CameraProblem, message: string, detail?: string) {
    super(message)
    this.name = 'CameraError'
    this.problem = problem
    this.detail = detail
  }
}

/** ¿La página puede pedir la cámara y los sensores? */
export function contextoSeguro(): boolean {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext) return true
  const host = location.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

export function camaraDisponible(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

function traducirError(error: unknown): CameraError {
  const name = error instanceof Error ? error.name : ''
  const detail = error instanceof Error ? error.message : String(error)

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError(
        'permiso',
        'No diste permiso para usar la cámara. Ábrelo desde el candado de la barra de direcciones y vuelve a intentar.',
        detail,
      )
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CameraError('sin-camara', 'Este dispositivo no tiene una cámara disponible.', detail)
    case 'NotReadableError':
    case 'TrackStartError':
      return new CameraError(
        'ocupada',
        'La cámara está ocupada por otra aplicación. Ciérrala y vuelve a intentar.',
        detail,
      )
    case 'OverconstrainedError':
      return new CameraError(
        'imposible',
        'La cámara de este teléfono no acepta la calidad que pedimos. Intenta de nuevo; se usará la configuración por defecto.',
        detail,
      )
    default:
      return new CameraError('desconocido', 'No se pudo abrir la cámara.', detail)
  }
}

export type CameraSession = {
  stream: MediaStream
  track: MediaStreamTrack
  /** Ancho y alto reales del video que entregó el navegador. */
  width: number
  height: number
  label: string
}

/**
 * Abre la cámara trasera.
 *
 * Se piden restricciones "ideal" y no "exact" a propósito: con `exact` un
 * teléfono que no puede dar 1920×1080 falla con OverconstrainedError en vez de
 * entregar lo que sí puede. Aun así se deja un reintento sin restricciones,
 * porque algunos navegadores rechazan combinaciones perfectamente razonables.
 */
export async function abrirCamara(deviceId?: string): Promise<CameraSession> {
  if (!contextoSeguro()) {
    throw new CameraError(
      'inseguro',
      'Para usar la cámara, el visor tiene que abrirse con https. Si estás probando desde la computadora, ábrelo en el celular con el link publicado.',
    )
  }
  if (!camaraDisponible()) {
    throw new CameraError('no-soportado', 'Este navegador no permite usar la cámara.')
  }

  const base: MediaTrackConstraints = {
    width: { ideal: IDEAL_WIDTH },
    height: { ideal: IDEAL_HEIGHT },
    aspectRatio: { ideal: 4 / 3 },
    // 30 y no 60: la captura dura minutos y el teléfono se calienta; cuando se
    // calienta, Android baja la resolución del stream a media panorámica y el
    // campo de visión cambia entre tomas.
    frameRate: { ideal: 30, max: 30 },
  }

  const intentos: MediaStreamConstraints[] = deviceId
    ? [{ video: { ...base, deviceId: { exact: deviceId } }, audio: false }]
    : [
        { video: { ...base, facingMode: { ideal: 'environment' } }, audio: false },
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        { video: true, audio: false },
      ]

  let ultimo: unknown = null
  for (const constraints of intentos) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      const track = stream.getVideoTracks()[0]
      const settings = track.getSettings()
      return {
        stream,
        track,
        width: settings.width ?? IDEAL_WIDTH,
        height: settings.height ?? IDEAL_HEIGHT,
        label: track.label || 'Cámara',
      }
    } catch (error) {
      ultimo = error
      // Sin permiso no sirve reintentar con otras restricciones.
      if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        break
      }
    }
  }

  throw traducirError(ultimo)
}

export function cerrarCamara(session: CameraSession | null) {
  if (!session) return
  for (const track of session.stream.getTracks()) track.stop()
}

/**
 * Intenta congelar exposición, enfoque y balance de blancos.
 *
 * Con auto-exposición, cada toma sale con un brillo distinto y las uniones de
 * la panorámica se notan como bandas. Chrome en Android suele aceptar esto;
 * Safari en iOS lo ignora, y ahí el plan B es la corrección de ganancia que
 * hace el costurero (ver ./stitcher.ts).
 *
 * Nunca lanza: si no se puede, se sigue.
 */
export async function fijarExposicion(session: CameraSession): Promise<boolean> {
  type Extendido = MediaTrackCapabilities & {
    exposureMode?: string[]
    whiteBalanceMode?: string[]
    focusMode?: string[]
  }

  try {
    const capabilities = session.track.getCapabilities?.() as Extendido | undefined
    if (!capabilities) return false

    const advanced: Record<string, string>[] = []
    if (capabilities.exposureMode?.includes('manual')) advanced.push({ exposureMode: 'manual' })
    if (capabilities.whiteBalanceMode?.includes('manual')) advanced.push({ whiteBalanceMode: 'manual' })
    if (capabilities.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' })
    if (advanced.length === 0) return false

    await session.track.applyConstraints({ advanced } as MediaTrackConstraints)
    return true
  } catch {
    return false
  }
}

/**
 * Lista de cámaras. Solo sirve DESPUÉS de conceder el permiso: antes de eso los
 * navegadores entregan las etiquetas vacías por privacidad.
 */
export async function listarCamaras(): Promise<MediaDeviceInfo[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'videoinput')
  } catch {
    return []
  }
}

const TRASERA = /(back|rear|trasera|posterior|environment)/i
const MALAS = /(ultra|gran\s*angular|wide\s*angle|0\.5|tele|dual|triple|virtual)/i

/**
 * Elige el lente PRINCIPAL de atrás.
 *
 * Pedir `facingMode: 'environment'` a secas no basta en un iPhone: el navegador
 * suele entregar la cámara "virtual" (Back Dual/Triple Wide), que cambia sola
 * de lente según a qué distancia enfoque. A media panorámica el campo de visión
 * se mueve y la costura se rompe. En algunas versiones de iOS también puede
 * caer en la ultra gran angular, que además distorsiona los bordes.
 *
 * Devuelve null si ninguna etiqueta se reconoce; en ese caso vale más quedarse
 * con lo que el navegador ya eligió que arriesgarse a abrir la cámara frontal.
 */
export function elegirLentePrincipal(camaras: MediaDeviceInfo[]): string | null {
  const traseras = camaras.filter((c) => TRASERA.test(c.label))
  if (traseras.length === 0) return null

  const simples = traseras.filter((c) => !MALAS.test(c.label))
  if (simples.length === 1) return simples[0].deviceId
  if (simples.length > 1) {
    // Con varias candidatas, la de etiqueta más corta suele ser la principal
    // ("Back Camera" contra "Back Telephoto Camera 3x").
    return [...simples].sort((a, b) => a.label.length - b.label.length)[0].deviceId
  }
  return null
}

/**
 * Vigila que la pista de video no se muera ni cambie de características.
 *
 * Tres cosas pasan de verdad en un teléfono a media captura: entra una llamada
 * (la pista se silencia), el usuario cambia de app (visibilitychange), o el
 * equipo se calienta y el navegador baja la resolución — y con ella cambia el
 * campo de visión, que es lo que rompe la costura.
 */
export function vigilarCamara(
  session: CameraSession,
  avisar: (motivo: 'interrumpida' | 'terminada' | 'cambio-de-formato', detalle?: string) => void,
): () => void {
  const { track } = session
  const anchoInicial = session.width
  const altoInicial = session.height

  const onMute = () => avisar('interrumpida')
  const onEnded = () => avisar('terminada')

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') return
    const ajustes = track.getSettings()
    if (
      (ajustes.width && ajustes.width !== anchoInicial) ||
      (ajustes.height && ajustes.height !== altoInicial)
    ) {
      avisar('cambio-de-formato', `${ajustes.width}×${ajustes.height}`)
    }
  }

  track.addEventListener('mute', onMute)
  track.addEventListener('ended', onEnded)
  document.addEventListener('visibilitychange', onVisibility)

  return () => {
    track.removeEventListener('mute', onMute)
    track.removeEventListener('ended', onEnded)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

/** Espera a que el <video> tenga dimensiones reales antes de dibujarlo. */
export function esperarVideo(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const listo = () => {
      limpiar()
      resolve()
    }
    const falla = () => {
      limpiar()
      reject(new CameraError('desconocido', 'El video de la cámara no arrancó.'))
    }
    const limpiar = () => {
      video.removeEventListener('loadeddata', listo)
      video.removeEventListener('error', falla)
    }
    video.addEventListener('loadeddata', listo)
    video.addEventListener('error', falla)
  })
}

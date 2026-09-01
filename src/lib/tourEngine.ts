/* oxlint-disable react/refs -- useCreateTourEngine usa el patrón estándar de
   inicialización perezosa de un ref; el valor no participa en el render. */
import { createContext, useContext, useRef } from 'react'

/**
 * ============================================================================
 *  EL PUENTE ENTRE LA UI Y LA CÁMARA
 * ============================================================================
 *
 * Un joystick emite ~120 eventos por segundo. Si cada uno pasara por
 * useState, React re-renderizaría el árbol entero 120 veces por segundo
 * y el visor se arrastraría en un celular de gama media.
 *
 * En lugar de eso usamos un objeto MUTABLE compartido:
 *
 *   Joystick / arrastre / zoom  ──escriben──▶  LookInput  ──lee──▶  CameraRig
 *                                                (ref)              (useFrame)
 *
 *   CameraRig ──escribe cada frame──▶ CameraReadout ──lee (rAF propio)──▶ Brújula / HUD
 *
 * Cero renders de React durante el movimiento. Los únicos re-renders reales
 * son los cambios de habitación y los estados visuales (joystick activo, etc).
 */

/** Lo que la UI le pide a la cámara. El CameraRig lo consume cada frame. */
export type LookInput = {
  /**
   * Eje continuo del joystick, ya normalizado a [-1, 1].
   *   x: +1 = girar a la derecha
   *   y: +1 = mirar hacia arriba   (ojo: la pantalla tiene la Y al revés,
   *                                 el Joystick ya hace la inversión)
   * Se interpreta como VELOCIDAD angular, no como posición.
   */
  axis: { x: number; y: number }

  /**
   * Deltas de un solo uso, en GRADOS, que acumulan el arrastre con el dedo/mouse.
   * El CameraRig los suma y los pone en 0 al terminar el frame.
   */
  dragYaw: number
  dragPitch: number

  /** Delta de zoom de un solo uso, en grados de FOV (rueda o pellizco). */
  dFov: number

  /**
   * Destino animado. Si no es null, el rig interpola hacia ahí y lo limpia al llegar.
   * Cualquier input manual del usuario lo cancela.
   */
  goto: { yaw: number; pitch: number } | null
}

/** Lo que la cámara le cuenta a la UI. El CameraRig lo escribe cada frame. */
export type CameraReadout = {
  yaw: number
  pitch: number
  fov: number
}

export type TourEngine = {
  input: LookInput
  readout: CameraReadout
  /**
   * ==========================================================================
   *  EL TIMBRE: "algo cambió, hay que repintar"
   * ==========================================================================
   *
   * Ni el visor 3D ni el HUD trabajan sesenta veces por segundo pase lo que
   * pase. Cuando la cámara está quieta no hay nada nuevo que pintar, y seguir
   * dibujando una esfera de 4096 px —y recalculando la posición de cada
   * marcador— solo calienta el teléfono y se come la pila. Medido: parado, el
   * visor pasó de 11 dibujos por segundo a CERO.
   *
   * El trato es que quien le escriba algo a `input` tiene que tocar el timbre,
   * o la imagen se queda congelada. Por eso vive aquí, junto al input: quien
   * escribe, avisa, en la línea de al lado.
   *
   * Una llamada despierta las dos capas y las mantiene despiertas un cuarto de
   * segundo. Como el `CameraRig` vuelve a tocar el timbre en cada cuadro
   * mientras la cámara se está acomodando, la animación se sostiene sola hasta
   * que se detiene de verdad.
   */
  invalidar: () => void

  /** La conecta CameraRig: es la que redibuja el canvas 3D. */
  conectarRender: (fn: (() => void) | null) => void

  /**
   * Suscribe algo del HUD (la brújula, los marcadores, el badge) al mismo
   * pulso. Devuelve la función para darse de baja.
   *
   * Antes cada pieza tenía su propio requestAnimationFrame, y los tres seguían
   * corriendo aunque la cámara llevara un minuto sin moverse.
   *
   * OJO, la regla que hay que recordar: el pulso se duerme solo. Cualquier cosa
   * que cambie lo que el HUD dibuja —un punto nuevo, un cambio de tamaño de la
   * ventana— tiene que llamar a `invalidar()`, o se quedará sin pintar hasta
   * que alguien mueva la cámara.
   */
  suscribirHud: (fn: () => void) => () => void
}

/** Cuánto se quedan despiertas las dos capas tras un aviso. */
const DESPIERTO_MS = 250

export const createTourEngine = (): TourEngine => {
  let render: (() => void) | null = null
  const hud = new Set<() => void>()
  let frame = 0
  let despiertoHasta = 0

  const tick = () => {
    for (const fn of hud) fn()
    if (performance.now() < despiertoHasta) {
      frame = requestAnimationFrame(tick)
    } else {
      frame = 0
    }
  }

  const invalidar = () => {
    render?.()
    despiertoHasta = performance.now() + DESPIERTO_MS
    if (frame === 0 && hud.size > 0) frame = requestAnimationFrame(tick)
  }

  return {
    input: { axis: { x: 0, y: 0 }, dragYaw: 0, dragPitch: 0, dFov: 0, goto: null },
    readout: { yaw: 0, pitch: 0, fov: 75 },
    invalidar,
    conectarRender: (fn) => {
      render = fn
    },
    suscribirHud: (fn) => {
      hud.add(fn)
      // Una pasada de inmediato: al montarse hay que colocarse aunque nadie se
      // haya movido todavía.
      fn()
      invalidar()
      return () => {
        hud.delete(fn)
      }
    },
  }
}

const TourEngineContext = createContext<TourEngine | null>(null)

export const TourEngineProvider = TourEngineContext.Provider

/** Devuelve el objeto compartido. Es estable: nunca cambia de identidad. */
export function useTourEngine(): TourEngine {
  const engine = useContext(TourEngineContext)
  if (!engine) {
    throw new Error('useTourEngine debe usarse dentro de <TourViewer />')
  }
  return engine
}

/** Crea el engine una sola vez por montaje del visor. */
export function useCreateTourEngine(): TourEngine {
  const ref = useRef<TourEngine | null>(null)
  if (ref.current === null) ref.current = createTourEngine()
  return ref.current
}

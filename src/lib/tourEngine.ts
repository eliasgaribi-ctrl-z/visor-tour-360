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
}

export const createTourEngine = (): TourEngine => ({
  input: { axis: { x: 0, y: 0 }, dragYaw: 0, dragPitch: 0, dFov: 0, goto: null },
  readout: { yaw: 0, pitch: 0, fov: 75 },
})

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

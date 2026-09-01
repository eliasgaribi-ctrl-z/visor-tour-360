/* oxlint-disable react/immutability -- El engine es un objeto mutable a propósito:
   es el canal sin renders entre los gestos y la cámara. Ver src/lib/tourEngine.ts */
import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import type { TourEngine } from './tourEngine'
import { DEG } from './math'

type Pointer = { x: number; y: number }

export type DragLookOptions = {
  /** Píxeles antes de considerar que es un arrastre y no un toque. */
  threshold?: number
  /** Grados de FOV por "notch" de rueda. */
  wheelZoomStep?: number
}

/**
 * Zoom con la rueda, suelto.
 *
 * Va aparte de `useDragLook` porque hay que colgarlo en DOS capas. Los
 * marcadores y el resto del HUD no viven dentro del div del canvas: son su
 * HERMANO, en una capa encima. Un evento de rueda encima de un marcador sube
 * por SU rama del árbol y nunca pasa por el manejador del canvas, así que el
 * zoom simplemente no hacía nada ahí.
 *
 * Se notaba poco porque depende de dónde quede la cámara: en el recorrido de
 * ejemplo pasa cuando el marcador de yaw 168 queda al centro de la pantalla.
 * Como las dos capas son hermanas, colgarlo en las dos no lo dispara dos veces.
 *
 * El arrastre NO se arregla así a propósito: empezar a arrastrar encima de un
 * marcador sigue sin girar la cámara (`data-no-drag`), porque ahí el gesto es
 * "voy a tocar este punto".
 */
export function useWheelZoom(engine: TourEngine, grados = 4) {
  return useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      engine.input.dFov += Math.sign(event.deltaY) * grados
      engine.invalidar()
    },
    [engine, grados],
  )
}

/**
 * Arrastrar con el dedo o el mouse para mirar alrededor, con pellizco para zoom.
 *
 * Convención "agarrar la foto": si arrastras a la derecha, la imagen se va a la
 * derecha, o sea que la cámara gira a la IZQUIERDA. Es lo que hace Google Street
 * View y lo que el pulgar espera.
 *
 * La conversión píxeles → grados es exacta, no un factor mágico: un píxel
 * vertical vale `fov / alto` grados, y uno horizontal vale `hfov / ancho`,
 * donde hfov sale del FOV vertical y el aspect ratio. Resultado: el punto de la
 * foto que agarraste se queda pegado al dedo, y el gesto se siente igual con
 * zoom abierto que cerrado.
 */
export function useDragLook(engine: TourEngine, options: DragLookOptions = {}) {
  const { threshold = 3, wheelZoomStep = 4 } = options

  const pointers = useRef(new Map<number, Pointer>())
  const dragging = useRef(false)
  const moved = useRef(0)
  const pinchDistance = useRef(0)

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    // Los hotspots viven en la capa de overlay, así que no llegan aquí,
    // pero por si acaso alguien mete un control dentro del canvas.
    if ((event.target as HTMLElement).closest?.('[data-no-drag]')) return

    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.currentTarget.setPointerCapture?.(event.pointerId)

    if (pointers.current.size === 1) {
      dragging.current = true
      moved.current = 0
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchDistance.current = Math.hypot(a.x - b.x, a.y - b.y)
    }
  }, [])

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const previous = pointers.current.get(event.pointerId)
      if (!previous) return

      const next = { x: event.clientX, y: event.clientY }
      pointers.current.set(event.pointerId, next)

      const rect = event.currentTarget.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return

      /* -------------------------------------------------- 2 dedos = pellizco */
      if (pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDistance.current > 0 && distance > 0) {
          // Separar los dedos = acercarse = reducir el FOV.
          const ratio = distance / pinchDistance.current
          engine.input.dFov += (1 - ratio) * engine.readout.fov
          engine.invalidar()
        }
        pinchDistance.current = distance
        return
      }

      /* --------------------------------------------------- 1 dedo = mirar */
      if (!dragging.current) return

      const dx = next.x - previous.x
      const dy = next.y - previous.y
      moved.current += Math.abs(dx) + Math.abs(dy)
      if (moved.current < threshold) return

      const fov = engine.readout.fov
      const aspect = rect.width / rect.height
      // FOV horizontal a partir del vertical: hfov = 2·atan(tan(fov/2)·aspect)
      const hfov = (2 * Math.atan(Math.tan((fov * DEG) / 2) * aspect)) / DEG

      engine.input.dragYaw -= (dx / rect.width) * hfov
      engine.input.dragPitch += (dy / rect.height) * fov
      engine.invalidar()
    },
    [engine, threshold],
  )

  const endPointer = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (pointers.current.size < 2) pinchDistance.current = 0
    if (pointers.current.size === 0) dragging.current = false
  }, [])

  const onWheel = useWheelZoom(engine, wheelZoomStep)

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
    onPointerLeave: endPointer,
    onWheel,
  }
}

/* oxlint-disable react/immutability -- La posición de cada marcador se escribe
   directo al DOM en cada cuadro, sin pasar por el estado de React: es el mismo
   patrón de HotspotLayer y por la misma razón. */
import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import type { Hotspot } from '../../lib/types'
import { useTourEngine } from '../../lib/tourEngine'
import { screenToYawPitch, yawPitchToScreen } from '../../lib/math'

export type PuntosEditablesProps = {
  hotspots: Hotspot[]
  seleccionado: string | null
  onSeleccionar: (id: string) => void
  /** Se llama mientras se arrastra y al soltar (al soltar, `final` es true). */
  onMover: (id: string, yaw: number, pitch: number, final: boolean) => void
}

/**
 * Los puntos del editor: se ven como en el visor, pero se pueden arrastrar.
 *
 * Arrastrar funciona porque el marcador está en la capa del HUD, que es hermana
 * del canvas y no su hija: el gesto nunca llega al arrastre de "mirar
 * alrededor", así que no hay que pelearse por el evento.
 *
 * Mientras el dedo se mueve, la posición se convierte de píxeles a (yaw, pitch)
 * con `screenToYawPitch`, que es exactamente la inversa de la proyección con la
 * que se pintan. Por eso el punto se queda pegado al dedo aunque la cámara esté
 * inclinada o con zoom.
 */
export function PuntosEditables({
  hotspots,
  seleccionado,
  onSeleccionar,
  onMover,
}: PuntosEditablesProps) {
  const engine = useTourEngine()
  const contenedor = useRef<HTMLDivElement>(null)
  const nodos = useRef(new Map<string, HTMLElement>())
  const arrastrando = useRef<string | null>(null)

  useEffect(() => {
    const caja = contenedor.current
    if (!caja) return

    let ancho = caja.clientWidth
    let alto = caja.clientHeight
    const observador = new ResizeObserver(() => {
      ancho = caja.clientWidth
      alto = caja.clientHeight
    })
    observador.observe(caja)

    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      if (!ancho || !alto) return

      for (const hotspot of hotspots) {
        const nodo = nodos.current.get(hotspot.id)
        if (!nodo) continue

        const punto = yawPitchToScreen(hotspot.yaw, hotspot.pitch, engine.readout, ancho, alto)
        if (!punto) {
          nodo.style.visibility = 'hidden'
          continue
        }
        nodo.style.visibility = 'visible'
        nodo.style.transform = `translate3d(${punto.x}px, ${punto.y}px, 0) translate(-50%, -50%)`
      }
    }

    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      observador.disconnect()
    }
  }, [engine, hotspots])

  /**
   * Convierte la posición del dedo a (yaw, pitch) y lo reporta.
   *
   * `final` viaja hasta aquí en vez de resolverse arriba porque al soltar hay
   * que guardar LA POSICIÓN DE ESTE EVENTO. Leer el hotspot del render sería
   * guardar la penúltima: el `setState` del último movimiento todavía no se
   * refleja en el closure que corre en el mismo tick.
   */
  const alMover = (event: ReactPointerEvent<HTMLElement>, id: string, final: boolean) => {
    if (arrastrando.current !== id) return
    const caja = contenedor.current
    if (!caja) return
    const rect = caja.getBoundingClientRect()
    const { yaw, pitch } = screenToYawPitch(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      engine.readout,
    )
    onMover(id, yaw, pitch, final)
  }

  return (
    <div ref={contenedor} className="pointer-events-none absolute inset-0 overflow-hidden">
      {hotspots.map((hotspot) => {
        const activo = hotspot.id === seleccionado
        return (
          <button
            key={hotspot.id}
            type="button"
            data-no-drag
            ref={(nodo) => {
              if (nodo) nodos.current.set(hotspot.id, nodo)
              else nodos.current.delete(hotspot.id)
            }}
            style={{ visibility: 'hidden' }}
            onPointerDown={(event) => {
              arrastrando.current = hotspot.id
              event.currentTarget.setPointerCapture(event.pointerId)
              onSeleccionar(hotspot.id)
            }}
            onPointerMove={(event) => alMover(event, hotspot.id, false)}
            onPointerUp={(event) => {
              if (arrastrando.current !== hotspot.id) return
              alMover(event, hotspot.id, true)
              arrastrando.current = null
            }}
            onPointerCancel={() => {
              arrastrando.current = null
            }}
            className={`pointer-events-auto absolute left-0 top-0 flex touch-none items-center gap-2
                        rounded-full py-1.5 pl-1.5 pr-3.5 text-sm font-medium text-white
                        ring-1 backdrop-blur-sm will-change-transform ${
                          activo
                            ? 'bg-brand-500/80 ring-white/80'
                            : 'bg-black/45 ring-white/25'
                        }`}
          >
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] ${
                hotspot.kind === 'link' ? 'bg-brand-500 text-black' : 'bg-white/85 text-black'
              }`}
            >
              {hotspot.kind === 'link' ? '→' : 'i'}
            </span>
            <span className="whitespace-nowrap drop-shadow">{hotspot.label}</span>
          </button>
        )
      })}
    </div>
  )
}

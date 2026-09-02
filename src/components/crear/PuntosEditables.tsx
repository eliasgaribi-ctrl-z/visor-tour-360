/* oxlint-disable react/immutability -- La posición de cada marcador se escribe
   directo al DOM en cada cuadro, sin pasar por el estado de React: es el mismo
   patrón de HotspotLayer y por la misma razón. */
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import type { Hotspot } from '../../lib/types'
import { useTourEngine } from '../../lib/tourEngine'
import { observarTamano } from '../../lib/observarTamano'
import { screenToYawPitch, yawPitchToScreen } from '../../lib/math3d'

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
  /* Los puntos se leen desde un ref y no desde las dependencias del efecto:
     arrastrar uno cambia el arreglo sesenta veces por segundo, y con él en las
     dependencias se rearmaba el observador de tamaño en cada movimiento del
     dedo. */
  const puntos = useRef(hotspots)
  // useLayoutEffect y no una asignación suelta: corre antes de pintar, así que
  // el marcador no se queda un cuadro atrás del dedo.
  //
  // Y toca el timbre: el pulso del HUD se duerme cuando la cámara está quieta,
  // así que un punto recién agregado no se colocaría —quedaría invisible en la
  // esquina— hasta que el usuario moviera la cámara por su cuenta.
  useLayoutEffect(() => {
    puntos.current = hotspots
    engine.invalidar()
  }, [engine, hotspots])
  /** Dónde empezó el gesto, para distinguir un toque de un arrastre. */
  const inicio = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const caja = contenedor.current
    if (!caja) return

    let ancho = caja.clientWidth
    let alto = caja.clientHeight
    /* Al cambiar de tamaño hay que TOCAR EL TIMBRE, no solo anotar la medida.
       El pulso del HUD se duerme cuando la cámara está quieta, y la primera
       medición llega justo después de montar: sin este aviso, los marcadores se
       quedaban sin colocar —invisibles en la esquina— hasta que el usuario
       moviera la cámara. */
    /* Con `observarTamano` y no con `new ResizeObserver` a secas: en iOS 13.0
       a 13.3 —dentro del piso que declara vite.config.ts— no existe, y como
       este componente NO está bajo ninguna frontera de error, el
       ReferenceError desmontaba la aplicación completa. Ver
       src/lib/observarTamano.ts.

       Ojo: se guarda SOLO la construcción del observador. Salirse del efecto
       cuando no existe dejaría sin correr el `suscribirHud` de abajo, que es
       lo único que coloca los marcadores —nacen con visibility:'hidden'—, y
       cambiaría una pantalla vacía por marcadores invisibles para siempre. */
    const soltarMedida = observarTamano(caja, () => {
      ancho = caja.clientWidth
      alto = caja.clientHeight
      engine.invalidar()
    })

    const desuscribir = engine.suscribirHud(() => {
      if (!ancho || !alto) return

      for (const hotspot of puntos.current) {
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
    })

    return () => {
      desuscribir()
      soltarMedida()
    }
  }, [engine])

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

  /** ¿El dedo se movió lo suficiente como para que esto sea un arrastre? */
  const paso = (event: ReactPointerEvent<HTMLElement>) =>
    Math.hypot(event.clientX - inicio.current.x, event.clientY - inicio.current.y) > 8

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
              inicio.current = { x: event.clientX, y: event.clientY }
              event.currentTarget.setPointerCapture(event.pointerId)
              onSeleccionar(hotspot.id)
            }}
            onPointerMove={(event) => {
              if (arrastrando.current !== hotspot.id) return
              if (!paso(event)) return
              alMover(event, hotspot.id, false)
            }}
            onPointerUp={(event) => {
              if (arrastrando.current !== hotspot.id) return
              /* Un toque para SELECCIONAR no debe mover el punto. El marcador
                 es una píldora ancha anclada por su centro, así que el dedo cae
                 casi siempre sobre la etiqueta, a decenas de píxeles del ancla:
                 sin este umbral, tocarlo lo mandaba de un salto al dedo y lo
                 guardaba ahí.

                 El orden importa: `alMover` comprueba que el gesto siga vivo,
                 así que `arrastrando` se limpia DESPUÉS de guardar. Al revés,
                 la posición final nunca llegaba a grabarse. */
              if (paso(event)) alMover(event, hotspot.id, true)
              arrastrando.current = null
            }}
            onPointerCancel={() => {
              arrastrando.current = null
            }}
            className={`pointer-events-auto absolute left-0 top-0 flex touch-none items-center gap-2
                        rounded-full py-2 pl-2 pr-4 text-sm font-medium text-white
                        ring-1 backdrop-blur-sm will-change-transform ${
                          activo
                            ? 'bg-brand-500/80 ring-white/80'
                            : 'bg-black/45 ring-white/25'
                        }`}
          >
            <span
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] ${
                hotspot.kind === 'link' ? 'bg-brand-500 text-[var(--tinta-marca,#000)]' : 'bg-white/85 text-black'
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

/* oxlint-disable react/immutability -- El cono se escribe directo al DOM en el
   pulso del HUD, como la brújula: cero renders de React mientras la cámara gira. */
import { useEffect, useRef } from 'react'

import type { Plano, TourScene } from '../../lib/types'
import { useTourEngine } from '../../lib/tourEngine'
import { anguloDelCono, caminoDelCono } from '../../lib/planta'

export type MinimapaProps = {
  plano: Plano
  scenes: TourScene[]
  activeId: string
  onSelect: (sceneId: string) => void
}

/** Radio del cono de vista, en unidades del SVG de 80×80 centrado en el alfiler. */
const RADIO_CONO = 34
/** Con qué apertura nace el cono antes de que el pulso lea el fov real. */
const FOV_INICIAL = 75

/**
 * ============================================================================
 *  EL MINIMAPA: LA BRÚJULA OTRA VEZ, SOBRE EL PLANO DE LA CASA
 * ============================================================================
 *
 * Un alfiler por habitación colocada, el de la habitación actual con un cono
 * que dice hacia dónde se está mirando, y tocar un alfiler cambia de cuarto
 * (por el mismo `goToScene` que la barra de habitaciones: sin puerta, sin
 * empuje).
 *
 * Está hecho como `Compass`, y por la misma razón: el cono lee `engine.readout`
 * en el pulso compartido del HUD y escribe el `transform` directo al SVG. Nunca
 * provoca un render de React, y cuando la cámara está quieta el pulso se detiene
 * solo, así que con el plano abierto el visor sigue en CERO dibujos por segundo
 * (`rendimiento.mjs` lo mide). La apertura del cono sigue al fov, pero solo se
 * reescribe cuando cambia más de un grado, como el número de la brújula.
 *
 * Suscribirse al pulso toca el timbre, y eso es lo que coloca el cono al abrir
 * el plano y al cambiar de habitación aunque la cámara no se mueva: sin el
 * timbre, el cono se quedaría apuntando a donde apuntaba el anterior.
 *
 * Los alfileres se colocan con `left`/`top` en porcentaje de la imagen, así que
 * no dependen del pulso ni del tamaño en píxeles del plano. El plano es un
 * `<img>` del DOM: no pasa por el caché de texturas ni ocupa memoria de video.
 *
 * Sin `giro` en la habitación actual no hay cono, solo el alfiler: la
 * orientación no se inventa. Ver `src/lib/planta.ts`.
 */
export function Minimapa({ plano, scenes, activeId, onSelect }: MinimapaProps) {
  const engine = useTourEngine()
  const cono = useRef<SVGGElement>(null)
  const sector = useRef<SVGPathElement>(null)

  const activa = scenes.find((s) => s.id === activeId)
  const giro = activa?.plano?.giro

  useEffect(() => {
    if (giro === undefined) return
    let fovPintado = -1
    return engine.suscribirHud(() => {
      const { yaw, fov } = engine.readout
      /* El atributo `transform` de SVG y no `style.transform`: rota alrededor
         del origen del viewBox, que está en el alfiler, sin depender de cómo
         cada navegador interprete `transform-origin` en un `<g>`. */
      cono.current?.setAttribute('transform', `rotate(${anguloDelCono(yaw, giro).toFixed(1)})`)
      if (sector.current && Math.abs(fov - fovPintado) > 1) {
        fovPintado = fov
        sector.current.setAttribute('d', caminoDelCono(fov, RADIO_CONO))
      }
    })
    /* `activeId` en las dependencias a propósito: al cambiar de habitación el
       cono es OTRO elemento, y volver a suscribirse toca el timbre que lo coloca
       aunque la cámara esté quieta. */
  }, [engine, giro, activeId])

  return (
    <div className="hud-glass pointer-events-auto rounded-hud p-1.5" role="group" aria-label="Plano de la casa">
      <div className="relative w-fit">
        <img
          src={plano.imagen}
          alt=""
          width={plano.ancho}
          height={plano.alto}
          draggable={false}
          className="block h-auto max-h-[36vh] w-auto max-w-[min(20rem,calc(100vw-1.5rem))] rounded-lg"
        />
        {scenes.map((s) => {
          if (!s.plano) return null
          const activo = s.id === activeId
          return (
            <button
              key={s.id}
              type="button"
              /* "en el plano" para no chocar con el botón del mismo nombre en la
                 barra de habitaciones: son dos controles distintos. */
              aria-label={`${s.name} en el plano`}
              aria-current={activo}
              onClick={() => onSelect(s.id)}
              style={{ left: `${s.plano.x * 100}%`, top: `${s.plano.y * 100}%` }}
              /* 44×44 de zona táctil; el punto que se ve mide 12–16 px. */
              className="absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center"
            >
              {activo && giro !== undefined && (
                <svg
                  viewBox="-40 -40 80 80"
                  className="pointer-events-none absolute h-20 w-20 overflow-visible"
                  aria-hidden
                >
                  <g ref={cono}>
                    <path ref={sector} d={caminoDelCono(FOV_INICIAL, RADIO_CONO)} className="fill-brand-500 opacity-40" />
                  </g>
                </svg>
              )}
              <span
                className={`relative rounded-full ring-2 ring-white ${
                  activo ? 'h-4 w-4 bg-brand-500' : 'h-3 w-3 bg-white/80'
                }`}
              />
            </button>
          )
        })}
      </div>
      {activa && (
        <p className="mt-1 max-w-[20rem] truncate text-center text-xs text-hud-2">{activa.name}</p>
      )}
    </div>
  )
}

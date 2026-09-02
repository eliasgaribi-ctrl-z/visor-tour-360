import { useEffect, useRef } from 'react'
import { useTourEngine } from '../../lib/tourEngine'
import { etiquetaDelDisco, giroDeBrujula, gradosParaMostrar } from '../../lib/rumbo'

/**
 * Brújula del HUD.
 *
 * Lee `engine.readout` en el pulso compartido del HUD y escribe el transform
 * directo al DOM. Nunca provoca un render de React, y cuando la cámara está
 * quieta el pulso se detiene solo: la brújula no gasta nada.
 *
 * ── Y desde hace poco, apunta al norte de verdad ───────────────────────────
 *
 * Antes su "N" señalaba el frente arbitrario de la foto —donde el agente tenía
 * el teléfono al empezar la captura— y el número eran grados de panorámica. O
 * sea que decía "norte" sin saber dónde estaba el norte. El dato para hacerlo
 * bien se calculaba en cada captura y se descartaba: ver `src/lib/rumbo.ts`.
 *
 * Con `rumbo` el disco se orienta al norte real y el número pasa a ser el rumbo
 * al que mira la cámara. Sin `rumbo` —una foto importada, que no tiene sensor
 * detrás— se comporta exactamente como antes, pero la etiqueta dice **"frente"**
 * en vez de "N". Es una decisión, no un descuido: una brújula que miente vale
 * menos que ninguna, y el disco sigue sirviendo para saber cuánto se giró.
 */
export function Compass({
  className = '',
  rumbo,
}: {
  className?: string
  /** Rumbo real del frente de la panorámica. Ausente = no se sabe. */
  rumbo?: number
}) {
  const engine = useTourEngine()
  const dialRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let lastShown = -1

    return engine.suscribirHud(() => {
      const yaw = engine.readout.yaw
      if (dialRef.current) {
        // El disco gira al revés que la cámara: el norte se queda quieto.
        dialRef.current.style.transform = `rotate(${giroDeBrujula(yaw, rumbo)}deg)`
      }
      const rounded = gradosParaMostrar(yaw, rumbo)
      if (labelRef.current && rounded !== lastShown) {
        lastShown = rounded
        labelRef.current.textContent = `${rounded}°`
      }
    })
    /* `rumbo` entra en las dependencias a propósito: al cambiar de habitación
       cambia, y esta suscripción tiene que volver a crearse con el nuevo valor.
       `suscribirHud` toca el timbre al suscribirse, así que el disco se recoloca
       de inmediato aunque la cámara esté quieta — que es justo el caso. */
  }, [engine, rumbo])

  const norte = etiquetaDelDisco(rumbo)

  return (
    <div
      className={`hud-glass pointer-events-none grid h-16 w-16 place-items-center rounded-full ${className}`}
      aria-hidden
    >
      <div ref={dialRef} className="absolute inset-1.5 will-change-transform">
        {/* La etiqueta de arriba cambia de ancho según diga "N" o "frente", así
            que el tamaño va en la clase y no se centra por el contenido. */}
        <span
          className={`absolute left-1/2 -translate-x-1/2 font-bold text-brand-400 ${
            norte === 'N' ? 'top-0.5 text-[10px]' : 'top-0 text-[8px] uppercase tracking-tight'
          }`}
        >
          {norte}
        </span>
        <span className="absolute right-0.5 top-1/2 -translate-y-1/2 text-[9px] text-ink-200">E</span>
        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[9px] text-ink-200">S</span>
        <span className="absolute left-0.5 top-1/2 -translate-y-1/2 text-[9px] text-ink-200">O</span>
      </div>
      <span ref={labelRef} className="text-[12px] font-semibold tabular-nums text-ink-50">
        0°
      </span>
    </div>
  )
}

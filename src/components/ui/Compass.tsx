import { useEffect, useRef } from 'react'
import { useTourEngine } from '../../lib/tourEngine'

/**
 * Brújula del HUD.
 *
 * Lee `engine.readout` en su propio requestAnimationFrame y escribe el
 * transform directo al DOM. Nunca provoca un render de React, aunque se
 * actualice 60 veces por segundo.
 */
export function Compass({ className = '' }: { className?: string }) {
  const engine = useTourEngine()
  const dialRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let frame = 0
    let lastShown = -1

    const tick = () => {
      frame = requestAnimationFrame(tick)
      const yaw = engine.readout.yaw
      if (dialRef.current) {
        // El disco gira al revés que la cámara: el norte se queda quieto.
        dialRef.current.style.transform = `rotate(${-yaw}deg)`
      }
      const rounded = Math.round(yaw)
      if (labelRef.current && rounded !== lastShown) {
        lastShown = rounded
        labelRef.current.textContent = `${rounded}°`
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [engine])

  return (
    <div
      className={`hud-glass pointer-events-none grid h-16 w-16 place-items-center rounded-full ${className}`}
      aria-hidden
    >
      <div ref={dialRef} className="absolute inset-1.5 will-change-transform">
        <span className="absolute left-1/2 top-0.5 -translate-x-1/2 text-[10px] font-bold text-brand-400">
          N
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

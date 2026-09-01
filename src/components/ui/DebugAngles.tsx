import { useEffect, useRef } from 'react'
import { useTourEngine } from '../../lib/tourEngine'

/**
 * Badge de desarrollo: muestra yaw / pitch / fov en vivo.
 * Sirve para sacar los ángulos exactos de un hotspot sin adivinar: apunta la
 * cámara a donde quieres el marcador y copia los números.
 */
export function DebugAngles() {
  const engine = useTourEngine()
  const ref = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let frame = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const { yaw, pitch, fov } = engine.readout
      if (ref.current) {
        const signedYaw = yaw > 180 ? yaw - 360 : yaw
        ref.current.textContent =
          `yaw ${signedYaw.toFixed(1).padStart(6)}°  ` +
          `pitch ${pitch.toFixed(1).padStart(5)}°  ` +
          `fov ${fov.toFixed(0).padStart(3)}°`
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [engine])

  return (
    <pre
      ref={ref}
      className="pointer-events-none rounded-lg bg-black/60 px-2 py-1 font-mono text-[10px]
                 leading-none text-brand-300 tabular-nums"
    />
  )
}

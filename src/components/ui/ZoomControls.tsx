/* oxlint-disable react/immutability -- Ver la nota de arquitectura en src/lib/tourEngine.ts */
import { useTourEngine } from '../../lib/tourEngine'

/** Botones de zoom. Empujan un delta de FOV al input; el rig lo suaviza. */
export function ZoomControls({ step = 10, className = '' }: { step?: number; className?: string }) {
  const engine = useTourEngine()

  const zoom = (direction: 1 | -1) => {
    // FOV más chico = más zoom, por eso el signo va invertido.
    engine.input.dFov += -direction * step
    engine.invalidar()
  }

  return (
    <div className={`hud-glass pointer-events-auto flex flex-col overflow-hidden rounded-2xl ${className}`}>
      <button
        type="button"
        onClick={() => zoom(1)}
        aria-label="Acercar"
        className="grid h-11 w-11 place-items-center text-xl leading-none text-ink-50 transition-colors active:bg-white/15"
      >
        +
      </button>
      <div className="h-px bg-white/10" />
      <button
        type="button"
        onClick={() => zoom(-1)}
        aria-label="Alejar"
        className="grid h-11 w-11 place-items-center text-xl leading-none text-ink-50 transition-colors active:bg-white/15"
      >
        −
      </button>
    </div>
  )
}

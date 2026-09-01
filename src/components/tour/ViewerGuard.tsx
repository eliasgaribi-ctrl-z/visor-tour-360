/**
 * Red de seguridad alrededor del <Canvas>.
 *
 * Sin esto, cuando el navegador no puede darnos un contexto WebGL —Safari de iOS
 * con poca memoria, "Modo de bajo consumo", un iPhone viejo, aceleración por
 * hardware apagada— la página se queda simplemente en negro y no hay forma de
 * saber qué pasó. Con esto, el usuario ve un mensaje y nosotros vemos el motivo.
 */
import { Component, type ReactNode } from 'react'

/** ¿Este navegador puede darnos WebGL ahora mismo? */
export function detectWebGL(): { ok: boolean; motivo?: string } {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    if (!gl) return { ok: false, motivo: 'el navegador no entregó un contexto WebGL' }
    return { ok: true }
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : String(e) }
  }
}

export function ViewerFallback({ motivo }: { motivo?: string }) {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-ink-900 p-6">
      <div className="max-w-sm text-center">
        <p className="text-base font-semibold text-ink-50">Este navegador no pudo abrir el visor 3D</p>
        <p className="mt-2 text-sm text-ink-200">
          El recorrido necesita WebGL. Suele resolverse cerrando pestañas y volviendo a cargar, o
          apagando el Modo de bajo consumo.
        </p>
        {motivo && (
          <p className="mt-4 break-words rounded-hud bg-black/40 px-3 py-2 text-left font-mono text-[11px] text-ink-200">
            {motivo}
          </p>
        )}
        <p className="mt-3 break-words text-left font-mono text-[10px] leading-relaxed text-ink-200/70">
          {ua}
        </p>
      </div>
    </div>
  )
}

type Props = { children: ReactNode }
type State = { motivo: string | null }

/**
 * Frontera de error de React: si el árbol del canvas revienta al montar, en vez
 * de tumbar toda la app mostramos el mensaje con la causa.
 */
export class ViewerBoundary extends Component<Props, State> {
  state: State = { motivo: null }

  static getDerivedStateFromError(error: unknown): State {
    return { motivo: error instanceof Error ? error.message : String(error) }
  }

  render() {
    if (this.state.motivo !== null) return <ViewerFallback motivo={this.state.motivo} />
    return this.props.children
  }
}

/**
 * Red de seguridad alrededor del <Canvas>.
 *
 * Sin esto, cuando el navegador no puede darnos un contexto WebGL —Safari de iOS
 * con poca memoria, "Modo de bajo consumo", un iPhone viejo, aceleración por
 * hardware apagada— la página se queda simplemente en negro y no hay forma de
 * saber qué pasó. Con esto, el usuario ve un mensaje y nosotros vemos el motivo.
 *
 * La detección en sí vive en src/lib/webgl.ts, no aquí: es una función suelta y
 * este archivo solo exporta componentes.
 */
import { Component, type ReactNode } from 'react'

import type { Deteccion } from '../../lib/webgl'

export function ViewerFallback({ motivo, causa }: { motivo?: string; causa?: Deteccion['causa'] }) {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent

  /* El consejo tiene que corresponder a lo que de verdad falta. "Cierra
     pestañas y vuelve a cargar" es un buen consejo cuando se agotaron los
     contextos WebGL, y es MENTIRA en un iPhone que no tiene WebGL 2: ahí no
     hay nada que cerrar, ese teléfono no va a abrir el recorrido por más que
     lo intente. Mandar a alguien a repetir un gesto que no puede funcionar es
     peor que no decir nada. */
  const sinWebgl2 = causa === 'sin-webgl2'

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-ink-900 p-6">
      <div className="max-w-sm text-center">
        <p className="text-base font-semibold text-ink-50">
          {sinWebgl2 ? 'Este teléfono no puede abrir el recorrido' : 'Este navegador no pudo abrir el visor 3D'}
        </p>
        <p className="mt-2 text-sm text-ink-200">
          {sinWebgl2 ? (
            <>
              El motor 3D necesita WebGL 2, y este navegador solo tiene WebGL 1. En un iPhone hace
              falta iOS 15 o más nuevo. Lo demás del sitio sí funciona: puedes ver la lista de
              recorridos y abrir un archivo .tour.
            </>
          ) : (
            <>
              El recorrido necesita WebGL. Suele resolverse cerrando pestañas y volviendo a cargar, o
              apagando el Modo de bajo consumo.
            </>
          )}
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

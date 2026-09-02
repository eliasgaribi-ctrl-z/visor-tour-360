import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { motivo: string | null }

/**
 * ============================================================================
 *  RED DE SEGURIDAD DE LA PANTALLA COMPLETA
 * ============================================================================
 *
 * Las cinco pantallas pesadas se cargan con `lazy()`. Si una no se puede
 * descargar o revienta al evaluarse, la promesa se rechaza, no hay nadie que lo
 * atrape y React desmonta la aplicación: `#root` se queda vacío y el usuario ve
 * negro sin una palabra.
 *
 * No se reutiliza la frontera del visor (`ViewerBoundary`): su mensaje habla de
 * WebGL, y aquí el problema casi nunca es ese. Un diagnóstico equivocado manda
 * a la persona a intentar cosas que no van a servir, que es peor que no decir
 * nada.
 */
export class PantallaBoundary extends Component<Props, State> {
  state: State = { motivo: null }

  static getDerivedStateFromError(error: unknown): State {
    return { motivo: error instanceof Error ? error.message : String(error) }
  }

  render() {
    if (this.state.motivo === null) return this.props.children

    return (
      <div className="alto-pantalla grid w-full place-items-center bg-ink-900 p-6 text-ink-50">
        <div className="max-w-sm text-center">
          <p className="text-base font-semibold">No se pudo abrir esta pantalla</p>
          <p className="mt-2 text-sm text-ink-200">
            Suele ser la conexión, o que el sitio se actualizó mientras lo tenías abierto. Vuelve a
            cargar y debería entrar.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-5 text-sm
                       font-semibold text-[var(--tinta-marca,#000)] active:bg-brand-600"
          >
            Volver a cargar
          </button>
          <p className="mt-4 break-words rounded-hud bg-black/40 px-3 py-2 text-left font-mono text-[11px] text-ink-200">
            {this.state.motivo}
          </p>
        </div>
      </div>
    )
  }
}

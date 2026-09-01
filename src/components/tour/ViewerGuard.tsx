/**
 * Red de seguridad alrededor del <Canvas>.
 *
 * Sin esto, cuando el navegador no puede darnos un contexto WebGL —Safari de iOS
 * con poca memoria, "Modo de bajo consumo", un iPhone viejo, aceleración por
 * hardware apagada— la página se queda simplemente en negro y no hay forma de
 * saber qué pasó. Con esto, el usuario ve un mensaje y nosotros vemos el motivo.
 */
import { Component, type ReactNode } from 'react'

export type Deteccion = {
  ok: boolean
  /** Para poder dar un consejo distinto según qué falta. */
  causa?: 'sin-webgl2' | 'sin-contexto' | 'excepcion'
  motivo?: string
}

let deteccion: Deteccion | null = null

/**
 * ¿Este navegador puede darnos WebGL ahora mismo?
 *
 * El contexto de prueba se SUELTA en cuanto se responde, y la respuesta se
 * guarda: un celular aguanta pocos contextos WebGL vivos a la vez (ocho o
 * dieciséis), y esta función se llama en cada montaje del visor y del editor.
 * Dejar uno abandonado en cada llamada se lleva por delante justo el que la
 * escena necesita.
 */
export function detectWebGL(): Deteccion {
  if (deteccion) return deteccion
  try {
    const canvas = document.createElement('canvas')

    /* WebGL 2 y NADA MÁS. Antes esto aceptaba un contexto WebGL 1 como bueno,
       y era peor que no detectar nada: three.js r185 pide `webgl2` a secas
       —la rama de WebGL 1 se quitó en r163— así que el canvas se montaba y el
       motor reventaba adentro. Y ese error no lo atrapa la frontera: R3F crea
       el renderer en un `configure()` asíncrono al que nadie le pone `.catch`,
       o sea que es una promesa rechazada, no una excepción de render. React no
       la ve. El resultado medido en un iPhone con iOS 13 no era una pantalla
       negra: era el velo de "Cargando panorámica…" girando para siempre, que
       para diagnosticar es todavía peor. */
    const gl2 = canvas.getContext('webgl2')
    if (!gl2) {
      // Se pregunta por WebGL 1 solo para poder decir CUÁL de los dos falta.
      const gl1 = canvas.getContext('webgl')
      // Soltar también aquí: antes solo se soltaba en el camino del éxito, y
      // un iPhone aguanta pocos contextos vivos.
      gl1?.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.width = 0
      canvas.height = 0
      deteccion = gl1
        ? {
            ok: false,
            causa: 'sin-webgl2',
            motivo: 'este navegador solo tiene WebGL 1; el motor 3D necesita WebGL 2',
          }
        : {
            ok: false,
            causa: 'sin-contexto',
            motivo: 'el navegador no entregó un contexto WebGL',
          }
      return deteccion
    }
    gl2.getExtension('WEBGL_lose_context')?.loseContext()
    canvas.width = 0
    canvas.height = 0
    deteccion = { ok: true }
  } catch (e) {
    deteccion = {
      ok: false,
      causa: 'excepcion',
      motivo: e instanceof Error ? e.message : String(e),
    }
  }
  return deteccion
}

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

import { memo, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import type { WebGLRenderer } from 'three'

import type { TourEngine } from '../../lib/tourEngine'
import { TourEngineProvider } from '../../lib/tourEngine'
import { useDragLook } from '../../lib/useDragLook'

import { CameraRig } from './CameraRig'
import { PanoSphere } from './PanoSphere'
import type { Nivel } from '../../lib/nivel'
import { ViewerBoundary, ViewerFallback } from './ViewerGuard'
import { aparato } from '../../lib/dispositivo'
import type { Deteccion } from '../../lib/webgl'

export const BASE_FOV = 75

/* Los dos objetos van FUERA del componente a propósito. Escritos en línea, cada
   render de Escena360 —o sea cada re-render del HUD que lo contiene: abrir una
   nota, retirar la pista— le pasaba a <Canvas> un objeto NUEVO, R3F lo tomaba
   por un cambio, reaplicaba la posición de la cámara y pedía un cuadro. Medido
   en giroscopio.mjs: 1 dibujo/s en la ventana de "quieto" justo cuando la pista
   se retiraba a los 7 s. Con la identidad estable no hay nada que aplicar y un
   re-render del HUD vuelve a costar cero dibujos. `rendimiento.mjs` lo mide
   abriendo y cerrando una nota. */
const GL = { antialias: false, powerPreference: 'high-performance' as const }
const CAMARA = { fov: BASE_FOV, near: 0.1, far: 1100, position: [0, 0, 0.001] as [number, number, number] }

export type Escena360Props = {
  engine: TourEngine
  /** URL de la equirectangular. */
  url: string
  initialYaw?: number
  /** Corrección de nivel de la foto. Ver src/lib/nivel.ts. */
  nivel?: Nivel
  webgl: Deteccion
  onLoadingChange?: (loading: boolean) => void
  onError?: () => void
  onPointerDownCapture?: () => void
  /** Cosas que van DENTRO del canvas (nada, normalmente). */
  children?: ReactNode
}

/**
 * La capa 3D: esfera, cámara y gestos.
 *
 * Vive aparte de <TourViewer> porque el editor de puntos necesita exactamente
 * la misma escena con otro HUD encima. Duplicarla habría significado que un
 * ajuste en la cámara se aplicara en un lado y no en el otro, que es la forma
 * más segura de que el editor coloque los puntos en un lugar y el visor los
 * pinte en otro.
 *
 * ── Por qué el desmontaje suelta el contexto a mano ────────────────────────
 *
 * Aquí decía antes que si no lo soltábamos nosotros el contexto se quedaba vivo
 * hasta que pasara el recolector de basura. Eso no es cierto, y conviene dejarlo
 * escrito porque invita a exagerar la importancia de este bloque: al desmontar
 * el <Canvas>, R3F llama a `forceContextLoss()` él solo. Está en
 * `unmountComponentAtNode` de @react-three/fiber 9, detrás de un
 * `setTimeout(…, 500)`. O sea que el contexto no se queda para siempre: se queda
 * medio segundo.
 *
 * Ese medio segundo es justo el que estorba. Un iPhone tolera entre ocho y
 * dieciséis contextos a la vez, y al entrar y salir del editor de puntos de
 * corrido el contexto nuevo se abre antes de que el viejo se haya soltado: se
 * solapan. Al pasarse del tope, el navegador empieza a matar los más viejos y la
 * escena se queda en negro, o la pestaña se recarga sola. Adelantarlo al
 * siguiente tick quita ese solapamiento.
 *
 * Y hay algo que R3F no hace en ningún momento: `renderer.dispose()`. Su
 * limpieza solo toca `renderLists`. Todo lo demás que three guarda del lado del
 * procesador —la caché de programas compilados, las propiedades por objeto, los
 * estados de binding, los grupos de uniforms— se queda colgando. Por eso el
 * `gl.dispose()` de abajo no sobra: es lo único que lo libera.
 */
/**
 * `memo`, y no por costumbre: cualquier estado del visor de arriba —abrir una
 * nota, retirar la pista, cambiar el aviso del giroscopio— re-renderiza a
 * `TourViewer`, y sin esto también a `<Canvas>`, que al reconfigurarse pide un
 * cuadro aunque la cámara no se haya movido. Medido en rendimiento.mjs: abrir y
 * cerrar una nota costaba 2 dibujos; con la capa 3D aislada, cero. Para que el
 * memo sirva, TODAS las props tienen que ser estables: los callbacks vienen en
 * `useCallback` desde arriba, no como flechas en línea.
 */
export const Escena360 = memo(function Escena360({
  engine,
  url,
  initialYaw = 0,
  nivel,
  webgl,
  onLoadingChange,
  onError,
  onPointerDownCapture,
  children,
}: Escena360Props) {
  const dragHandlers = useDragLook(engine)
  const renderer = useRef<WebGLRenderer | null>(null)
  const soltarRestaurado = useRef<(() => void) | null>(null)

  const alCrear = useCallback(
    ({ gl }: { gl: WebGLRenderer }) => {
      renderer.current = gl

      /* Cuando el sistema le quita la tarjeta gráfica a la pestaña y después se
         la devuelve, three rehace solo todo lo que tenía subido —texturas,
         programas, búferes— pero lo hace dentro del siguiente cuadro que se
         dibuje. Y aquí abajo el canvas está en `frameloop="demand"`: nadie
         dibuja si nadie lo pide, y recuperar el contexto no es un gesto de
         nadie. Sin esta línea el visor se queda negro para siempre con el
         contexto ya sano, esperando un cuadro que no va a pedir nadie. */
      const alRestaurar = () => engine.invalidar()
      gl.domElement.addEventListener('webglcontextrestored', alRestaurar)
      soltarRestaurado.current = () => {
        gl.domElement.removeEventListener('webglcontextrestored', alRestaurar)
      }
    },
    [engine],
  )

  useEffect(
    () => () => {
      /* Antes que nada, y sin esperar al tick: el `forceContextLoss()` de aquí
         abajo dispara eventos de contexto sobre este mismo canvas, y no tiene
         caso que lleguen a un engine que ya se está desmontando. */
      soltarRestaurado.current?.()
      soltarRestaurado.current = null

      const gl = renderer.current
      renderer.current = null
      if (!gl) return
      /* En el siguiente tick: cuando corre esta limpieza, React todavía está
         desmontando el árbol de adentro del canvas, y quitarle el contexto a
         medio desmontaje revienta. */
      setTimeout(() => {
        try {
          gl.forceContextLoss()
        } catch {
          // Un contexto ya perdido no se puede volver a perder.
        }
        gl.dispose()
      }, 0)
    },
    [],
  )

  return (
    <div
      className="absolute inset-0 z-0"
      onPointerDownCapture={onPointerDownCapture}
      {...dragHandlers}
    >
      {webgl.ok ? (
        <ViewerBoundary>
        <Canvas
          flat
          /* "a pedido": no se dibuja nada hasta que alguien lo pida. Un
             recorrido se mira parado la mayor parte del tiempo, y redibujar una
             esfera de 4096 px sesenta veces por segundo para mostrar lo mismo
             solo calienta el teléfono. Quien mueve algo pide cuadro con
             `engine.invalidar()`; ver src/lib/tourEngine.ts. */
          frameloop="demand"
          /* En un teléfono de gama baja se dibuja a 1x (ver src/lib/dispositivo.ts).
             Un 2x en una pantalla de 390×844 son cinco megabytes más de búfer:
             no es lo que tira la pestaña, pero va en el mismo paquete que
             bajarle la resolución a la textura, y las dos decisiones tienen
             que ser coherentes o la foto se ve borrosa sin ganar nada. */
          dpr={aparato().dpr}
          /* antialias: false a propósito. El suavizado de bordes sirve para
             las aristas de la geometría, y aquí NO HAY aristas: toda la
             pantalla es una sola esfera con una foto encima. Lo único que
             hacía era reservar un búfer multimuestreado —de dos a cuatro
             veces el tamaño del normal— para no mejorar ni un píxel. */
          gl={GL}
          camera={CAMARA}
          onCreated={alCrear}
        >
            {/* El puente de contexto: <Canvas> monta su propio reconciliador de
                React, así que el provider se vuelve a colocar aquí adentro. */}
            <TourEngineProvider value={engine}>
              <CameraRig fov={BASE_FOV} initialYaw={initialYaw} />
              <PanoSphere url={url} nivel={nivel} onLoadingChange={onLoadingChange} onError={onError} />
              {children}
            </TourEngineProvider>
          </Canvas>
        </ViewerBoundary>
      ) : (
        <ViewerFallback motivo={webgl.motivo} causa={webgl.causa} />
      )}
    </div>
  )
})

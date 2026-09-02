import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import type { WebGLRenderer } from 'three'

import type { TourEngine } from '../../lib/tourEngine'
import { TourEngineProvider } from '../../lib/tourEngine'
import { useDragLook } from '../../lib/useDragLook'

import { CameraRig } from './CameraRig'
import { PanoSphere } from './PanoSphere'
import type { Nivel } from '../../lib/nivel'
import { detectWebGL, ViewerBoundary, ViewerFallback, type Deteccion } from './ViewerGuard'
import { aparato } from '../../lib/dispositivo'

export const BASE_FOV = 75

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
 * ── Por qué hay que soltar el contexto a mano ──────────────────────────────
 *
 * Cada montaje de este componente abre un contexto WebGL, y `renderer.dispose()`
 * NO lo cierra: solo suelta lo que three tenía adentro. El contexto sigue vivo
 * hasta que el recolector de basura pase, y nadie sabe cuándo es eso.
 *
 * Medido en el propio recorrido —entrar y salir tres veces del editor de
 * puntos— se acumulaban seis contextos. Un iPhone tolera entre ocho y dieciséis
 * a la vez: al pasarse, el navegador empieza a matar los más viejos y la escena
 * se queda en negro, o la pestaña se recarga sola. `forceContextLoss()` es la
 * única forma de decirle al navegador "este ya no lo necesito".
 */
export function Escena360({
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

  const alCrear = useCallback(({ gl }: { gl: WebGLRenderer }) => {
    renderer.current = gl
  }, [])

  useEffect(
    () => () => {
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
          gl={{ antialias: false, powerPreference: 'high-performance' }}
          camera={{ fov: BASE_FOV, near: 0.1, far: 1100, position: [0, 0, 0.001] }}
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
}

export { detectWebGL }

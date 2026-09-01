import type { ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'

import type { TourEngine } from '../../lib/tourEngine'
import { TourEngineProvider } from '../../lib/tourEngine'
import { useDragLook } from '../../lib/useDragLook'

import { CameraRig } from './CameraRig'
import { PanoSphere } from './PanoSphere'
import { detectWebGL, ViewerBoundary, ViewerFallback } from './ViewerGuard'

export const BASE_FOV = 75

export type Escena360Props = {
  engine: TourEngine
  /** URL de la equirectangular. */
  url: string
  initialYaw?: number
  webgl: { ok: boolean; motivo?: string }
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
 */
export function Escena360({
  engine,
  url,
  initialYaw = 0,
  webgl,
  onLoadingChange,
  onError,
  onPointerDownCapture,
  children,
}: Escena360Props) {
  const dragHandlers = useDragLook(engine)

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
            dpr={[1, 2]}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
            camera={{ fov: BASE_FOV, near: 0.1, far: 1100, position: [0, 0, 0.001] }}
          >
            {/* El puente de contexto: <Canvas> monta su propio reconciliador de
                React, así que el provider se vuelve a colocar aquí adentro. */}
            <TourEngineProvider value={engine}>
              <CameraRig fov={BASE_FOV} initialYaw={initialYaw} />
              <PanoSphere url={url} onLoadingChange={onLoadingChange} onError={onError} />
              {children}
            </TourEngineProvider>
          </Canvas>
        </ViewerBoundary>
      ) : (
        <ViewerFallback motivo={webgl.motivo} />
      )}
    </div>
  )
}

export { detectWebGL }

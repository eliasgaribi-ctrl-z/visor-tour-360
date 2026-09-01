/* oxlint-disable react/immutability -- Ver la nota de arquitectura en src/lib/tourEngine.ts */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Hotspot, Tour } from '../lib/types'
import { TourEngineProvider, useCreateTourEngine } from '../lib/tourEngine'
import { useKeyboardLook } from '../lib/useKeyboardLook'
import { preloadEquirect } from '../lib/useEquirectTexture'

import { BASE_FOV, Escena360, detectWebGL } from './tour/Escena360'

import { Compass } from './ui/Compass'
import { DebugAngles } from './ui/DebugAngles'
import { HotspotLayer } from './ui/HotspotLayer'
import { InfoSheet } from './ui/InfoSheet'
import { Joystick } from './ui/Joystick'
import { LoadingVeil } from './ui/LoadingVeil'
import { RoomBar } from './ui/RoomBar'
import { ZoomControls } from './ui/ZoomControls'

export type TourViewerProps = {
  tour: Tour
  /** Muestra el badge con yaw/pitch/fov. Por defecto solo en desarrollo. */
  debug?: boolean
  /** Botón extra en la barra superior (volver, menú, editar…). */
  accion?: ReactNode
}

/**
 * ============================================================================
 *  VISOR COMPLETO
 * ============================================================================
 *
 * Dos capas, y nada más:
 *
 *   z-0   <Canvas>  ··· la esfera 360. Recibe el arrastre y el pellizco.
 *   z-30  overlay   ··· HUD transparente. pointer-events-none en el contenedor
 *                       y pointer-events-auto SOLO en los controles, para que
 *                       el dedo atraviese los huecos y siga mirando alrededor.
 *
 * El estado de React solo cambia con cosas "grandes" (habitación, carga, panel
 * abierto). El movimiento de la cámara viaja por el objeto mutable del engine.
 */
export function TourViewer({ tour, debug = import.meta.env.DEV, accion }: TourViewerProps) {
  const engine = useCreateTourEngine()

  const [sceneId, setSceneId] = useState(tour.startSceneId)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [info, setInfo] = useState<{ title: string; body?: string } | null>(null)
  const [hintVisible, setHintVisible] = useState(true)
  const hintDismissed = useRef(false)

  /* Se pregunta UNA vez, antes de montar el canvas: si el navegador no da WebGL
     preferimos un mensaje a una pantalla negra sin explicación. */
  const [webgl] = useState(detectWebGL)

  const scene = useMemo(
    () => tour.scenes.find((s) => s.id === sceneId) ?? tour.scenes[0],
    [sceneId, tour.scenes],
  )

  useKeyboardLook(engine)

  const dismissHint = useCallback(() => {
    if (hintDismissed.current) return
    hintDismissed.current = true
    setHintVisible(false)
  }, [])

  /** El joystick escribe aquí. Es la única línea que conecta UI y cámara. */
  const handleAxis = useCallback(
    (x: number, y: number) => {
      engine.input.axis.x = x
      engine.input.axis.y = y
      if (x !== 0 || y !== 0) dismissHint()
    },
    [engine, dismissHint],
  )

  const goToScene = useCallback(
    (id: string, arriveYaw?: number) => {
      const next = tour.scenes.find((s) => s.id === id)
      if (!next || next.id === sceneId) return
      setInfo(null)
      setFailed(false)
      setSceneId(next.id)
      // La cámara viaja al frente de la nueva habitación por el camino corto.
      engine.input.goto = { yaw: arriveYaw ?? next.initialYaw ?? 0, pitch: 0 }
    },
    [engine, sceneId, tour.scenes],
  )

  const handleHotspot = useCallback(
    (hotspot: Hotspot) => {
      dismissHint()
      if (hotspot.kind === 'link') goToScene(hotspot.to, hotspot.arriveYaw)
      else setInfo({ title: hotspot.label, body: hotspot.body })
    },
    [dismissHint, goToScene],
  )

  const resetView = useCallback(() => {
    engine.input.goto = { yaw: scene.initialYaw ?? 0, pitch: 0 }
    engine.input.dFov += BASE_FOV - engine.readout.fov
  }, [engine, scene.initialYaw])

  /** Si nadie toca nada, la pista se retira sola a los 7 segundos. */
  useEffect(() => {
    const timer = window.setTimeout(dismissHint, 7000)
    return () => window.clearTimeout(timer)
  }, [dismissHint])

  /** Precarga las habitaciones vecinas: el salto se siente instantáneo. */
  useEffect(() => {
    for (const hotspot of scene.hotspots) {
      if (hotspot.kind !== 'link') continue
      const target = tour.scenes.find((s) => s.id === hotspot.to)
      if (target) preloadEquirect(target.image)
    }
  }, [scene, tour.scenes])

  return (
    <TourEngineProvider value={engine}>
      {/* 100dvh y no 100vh: en móvil, vh no descuenta la barra del navegador
          y el joystick se queda debajo del borde de la pantalla. */}
      <div className="relative h-[100dvh] w-full overflow-hidden bg-black">
        {/* ───────────────────────────── CAPA 0 · el visor 360 ───────────────────────────── */}
        <Escena360
          engine={engine}
          url={scene.image}
          initialYaw={scene.initialYaw ?? 0}
          webgl={webgl}
          onLoadingChange={setLoading}
          onError={() => setFailed(true)}
          onPointerDownCapture={dismissHint}
        />

        {/* ───────────────────────────── CAPA 1 · HUD ───────────────────────────── */}
        <div className="pointer-events-none absolute inset-0 z-30">
          {/* Hotspots: van pegados a la escena pero son DOM de verdad. */}
          <HotspotLayer hotspots={scene.hotspots} onSelect={handleHotspot} />

          {/* Barra superior */}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3
                          pt-[calc(env(safe-area-inset-top)+0.75rem)]">
            <div className="hud-glass pointer-events-auto min-w-0 rounded-hud px-4 py-2.5">
              <p className="truncate text-sm font-semibold text-ink-50">{tour.title}</p>
              <p className="truncate text-xs text-ink-200">{scene.name}</p>
            </div>
            <div className="flex shrink-0 items-start gap-2">
              {accion}
              <Compass className="relative shrink-0" />
            </div>
          </div>

          {/* Selector de habitaciones, arriba: deja todo el borde inferior libre
              para los pulgares, que es lo que se toca de verdad en un celular. */}
          <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+5.25rem)] px-3">
            <RoomBar scenes={tour.scenes} activeId={scene.id} onSelect={(id) => goToScene(id)} />
          </div>

          {/* Joystick · esquina inferior IZQUIERDA, zona del pulgar izquierdo */}
          <div className="absolute bottom-0 left-0 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <Joystick className="h-40 w-40 sm:h-44 sm:w-44" onChange={handleAxis} />
          </div>

          {/* Zoom y reencuadre · pulgar derecho */}
          <div className="absolute bottom-0 right-0 flex flex-col items-end gap-2 p-3
                          pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            <button
              type="button"
              onClick={resetView}
              aria-label="Reencuadrar"
              className="hud-glass pointer-events-auto grid h-11 w-11 place-items-center rounded-2xl
                         text-ink-50 transition-colors active:bg-white/15"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 4v3M12 17v3M4 12h3M17 12h3" strokeLinecap="round" />
                <circle cx="12" cy="12" r="5" />
              </svg>
            </button>
            <ZoomControls />
          </div>

          {/* Pista de arranque · por encima de la fila de controles */}
          <div
            className={`absolute bottom-[calc(env(safe-area-inset-bottom)+12rem)] left-1/2 w-[min(20rem,90vw)]
                        -translate-x-1/2 transition-opacity duration-500 ${
                          hintVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
                        }`}
          >
            <p className="hud-glass rounded-full px-4 py-2 text-center text-xs text-ink-200">
              Arrastra la foto o usa el joystick para mirar alrededor
            </p>
          </div>

          {debug && (
            <div className="absolute left-3 top-[calc(env(safe-area-inset-top)+9rem)]">
              <DebugAngles />
            </div>
          )}
        </div>

        {/* Estados */}
        <LoadingVeil visible={webgl.ok && loading && !failed} />

        {failed && (
          <div className="absolute inset-0 z-40 grid place-items-center bg-black/80 p-6 text-center">
            <div>
              <p className="text-sm font-semibold text-ink-50">No se pudo cargar la panorámica</p>
              <p className="mt-1 text-xs text-ink-200">{scene.image}</p>
            </div>
          </div>
        )}

        {info && <InfoSheet title={info.title} body={info.body} onClose={() => setInfo(null)} />}
      </div>
    </TourEngineProvider>
  )
}

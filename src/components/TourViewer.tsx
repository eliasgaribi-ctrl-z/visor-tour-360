/* oxlint-disable react/immutability -- Ver la nota de arquitectura en src/lib/tourEngine.ts */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useWheelZoom } from '../lib/useDragLook'
import type { Hotspot, Tour } from '../lib/types'
import { TourEngineProvider, useCreateTourEngine } from '../lib/tourEngine'
import { useKeyboardLook } from '../lib/useKeyboardLook'
import { useGyroLook } from '../lib/useGyroLook'
import { preloadEquirect } from '../lib/useEquirectTexture'
import { aparato } from '../lib/dispositivo'
import { detectWebGL } from '../lib/webgl'
import type { Metricas } from '../lib/metricas/cliente'

import { BASE_FOV, Escena360 } from './tour/Escena360'

import { Compass } from './ui/Compass'
import { DebugAngles } from './ui/DebugAngles'
import { HotspotLayer } from './ui/HotspotLayer'
import { InfoSheet } from './ui/InfoSheet'
import { Joystick } from './ui/Joystick'
import { LoadingVeil } from './ui/LoadingVeil'
import { Minimapa } from './ui/Minimapa'
import { RoomBar } from './ui/RoomBar'
import { ZoomControls } from './ui/ZoomControls'

export type TourViewerProps = {
  tour: Tour
  /** Muestra el badge con yaw/pitch/fov. Por defecto solo en desarrollo. */
  debug?: boolean
  /** Botón extra en la barra superior (volver, menú, editar…). */
  accion?: ReactNode
  /** Pista que aparece los primeros segundos, debajo de los controles. */
  pista?: string
  /**
   * A quién reportar qué habitación se vio, qué punto se tocó y qué falló.
   * Solo lo trae la casa PUBLICADA (`VisorPublicado`); el visor local y la
   * demo no lo pasan y no reportan nada. Ver `src/lib/metricas/cliente.ts`.
   */
  metricas?: Metricas | null
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
export function TourViewer({
  tour,
  debug = import.meta.env.DEV,
  accion,
  pista = 'Arrastra la foto o usa el joystick para mirar alrededor',
  metricas = null,
}: TourViewerProps) {
  const engine = useCreateTourEngine()
  /* La rueda también sobre el HUD: ver useWheelZoom en src/lib/useDragLook.ts */
  const zoomRueda = useWheelZoom(engine)

  const [sceneId, setSceneId] = useState(tour.startSceneId)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [info, setInfo] = useState<{ title: string; body?: string } | null>(null)
  const [hintVisible, setHintVisible] = useState(true)
  /* El minimapa del plano, si el recorrido trae uno. Cerrado al entrar: en un
     teléfono tapa un cuarto de la foto, y la foto es a lo que se vino. */
  const [planoAbierto, setPlanoAbierto] = useState(false)
  const hintDismissed = useRef(false)
  const cartelError = useRef<HTMLDivElement>(null)

  /* Se pregunta UNA vez, antes de montar el canvas: si el navegador no da WebGL
     preferimos un mensaje a una pantalla negra sin explicación. */
  const [webgl] = useState(detectWebGL)

  const scene = useMemo(
    () => tour.scenes.find((s) => s.id === sceneId) ?? tour.scenes[0],
    [sceneId, tour.scenes],
  )

  useKeyboardLook(engine)

  /* Mirar moviendo el teléfono. Solo aquí y no en el editor de puntos: para
     colocar un punto hace falta un encuadre quieto. */
  const giro = useGyroLook(engine)
  const sensorActivo = giro.estado === 'activo' || giro.estado === 'esperando'
  /* Los dos estados que hay que EXPLICAR: sin permiso (en iOS solo se revierte
     en Ajustes) y sin sensores (escritorio). El aviso se va solo a los seis
     segundos, y se marca como visto con un temporizador y no con un set en el
     efecto —la regla de este proyecto sobre estado dentro de efectos—. */
  const [avisoVisto, setAvisoVisto] = useState<string | null>(null)
  const avisoGiro =
    avisoVisto === giro.estado
      ? null
      : giro.estado === 'denegado'
        ? 'Sin permiso para los sensores. En iPhone se activa en Ajustes → Safari → Movimiento y orientación.'
        : giro.estado === 'permiso-pendiente'
          ? 'Toca otra vez el botón y elige Permitir para mirar con el teléfono.'
          : giro.estado === 'no-soportado'
            ? 'Este aparato no tiene sensores de movimiento.'
            : null
  useEffect(() => {
    if (!avisoGiro) return
    const estado = giro.estado
    const t = window.setTimeout(() => setAvisoVisto(estado), 6000)
    return () => window.clearTimeout(t)
  }, [avisoGiro, giro.estado])

  /* El modo kiosco viene del recorrido, no del visor: un recorrido de feria gira
     solo y el mismo visor con otro recorrido no. Tocar el timbre arranca el
     primer cuadro; de ahí en adelante el rig se sostiene solo mientras gira. */
  useEffect(() => {
    engine.input.autogiro = tour.autogiro === true
    engine.invalidar()
  }, [engine, tour.autogiro])

  const dismissHint = useCallback(() => {
    if (hintDismissed.current) return
    hintDismissed.current = true
    setHintVisible(false)
  }, [])

  /* ── Las métricas, en los tres embudos que ya existían ─────────────────────
     La primera habitación al montar; las demás pasan TODAS por `goToScene`; los
     puntos por `handleHotspot`; las fallas por `alFallar`. Cada una es una
     línea, porque el visor ya tenía un solo camino para cada cosa. Sin
     `metricas` (visor local, demo) no se reporta nada. */
  useEffect(() => {
    metricas?.escena(tour.startSceneId)
  }, [metricas, tour.startSceneId])

  /* El nombre de la habitación actual, para nombrar la falla sin volver
     inestable a `alFallar` (ver abajo). */
  const nombreEscena = useRef(scene.name)
  useEffect(() => {
    nombreEscena.current = scene.name
  }, [scene.name])

  /* Estable a propósito: `Escena360` está en `memo`, y una flecha nueva aquí lo
     re-renderizaría —y con él al canvas— en cada estado del HUD. */
  const alFallar = useCallback(() => {
    setFailed(true)
    metricas?.falla(nombreEscena.current)
  }, [metricas])

  /** Un dedo sobre la foto: se va la pista y, si la foto giraba sola, se detiene. */
  const alTocar = useCallback(() => {
    dismissHint()
    engine.input.pausa = true
    engine.invalidar()
  }, [dismissHint, engine])

  /** El joystick escribe aquí. Es la única línea que conecta UI y cámara. */
  const handleAxis = useCallback(
    (x: number, y: number) => {
      engine.input.axis.x = x
      engine.input.axis.y = y
      engine.invalidar()
      if (x !== 0 || y !== 0) dismissHint()
    },
    [engine, dismissHint],
  )

  const goToScene = useCallback(
    (id: string, arriveYaw?: number, puerta?: { yaw: number; pitch: number }) => {
      const next = tour.scenes.find((s) => s.id === id)
      if (!next || next.id === sceneId) return
      setInfo(null)
      setFailed(false)
      setSceneId(next.id)
      metricas?.escena(next.id)
      // La cámara viaja al frente de la nueva habitación por el camino corto.
      engine.input.goto = { yaw: arriveYaw ?? next.initialYaw ?? 0, pitch: 0 }
      /* Y si se vino por una PUERTA, la atraviesa: el rig empuja la cámara hacia
         el punto tocado mientras dura el fundido. Desde la barra de habitaciones
         no hay puerta —se salta de cuarto en cuarto— y no se empuja. */
      if (puerta) engine.input.empuje = puerta
      engine.invalidar()
    },
    [engine, metricas, sceneId, tour.scenes],
  )

  const handleHotspot = useCallback(
    (hotspot: Hotspot) => {
      dismissHint()
      metricas?.punto(hotspot.id, hotspot.kind)
      if (hotspot.kind === 'link') {
        goToScene(hotspot.to, hotspot.arriveYaw, { yaw: hotspot.yaw, pitch: hotspot.pitch })
      } else {
        setInfo({ title: hotspot.label, body: hotspot.body })
      }
    },
    [dismissHint, goToScene, metricas],
  )

  const resetView = useCallback(() => {
    engine.input.goto = { yaw: scene.initialYaw ?? 0, pitch: 0 }
    engine.input.gotoFov = BASE_FOV
    engine.invalidar()
  }, [engine, scene.initialYaw])

  /* El cartel de "no se pudo cargar la foto" tapa la pantalla entera pero no
     recibía el foco, así que con teclado o lector de pantalla no había manera de
     leerlo: el foco seguía en los controles de abajo, que quedaron debajo del
     velo y ya no hacen nada. role="alert" lo anuncia y el focus() lleva ahí. */
  useEffect(() => {
    if (failed) cartelError.current?.focus()
  }, [failed])

  /** Si nadie toca nada, la pista se retira sola a los 7 segundos. */
  useEffect(() => {
    const timer = window.setTimeout(dismissHint, 7000)
    return () => window.clearTimeout(timer)
  }, [dismissHint])

  /**
   * Precarga las habitaciones vecinas: el salto se siente instantáneo.
   *
   * Con dos frenos, los dos medidos:
   *
   * SOLO UNAS CUANTAS, no todas. Cada panorámica precargada son decenas de
   * megabytes de memoria de video, y un cuarto con cinco puertas llenaría el
   * caché de golpe con habitaciones a las que quizá nadie va a entrar. Cuántas
   * lo decide el aparato (ver src/lib/dispositivo.ts).
   *
   * Y MÁS TARDE, no ahora mismo. Subir una textura a la tarjeta gráfica bloquea
   * el hilo principal, y hacerlo justo cuando el usuario acaba de entrar a la
   * habitación le suma ese bloqueo al de la foto que sí está esperando: tres
   * subidas encimadas en el peor momento. Esperando a que la escena se asiente,
   * las vecinas se bajan mientras la persona mira alrededor, que es cuando no
   * molesta. Se escalonan entre sí por lo mismo.
   */
  useEffect(() => {
    const vecinas: string[] = []
    let quedan = aparato().precargas
    for (const hotspot of scene.hotspots) {
      if (quedan <= 0) break
      if (hotspot.kind !== 'link') continue
      const target = tour.scenes.find((s) => s.id === hotspot.to)
      if (!target) continue
      vecinas.push(target.image)
      quedan--
    }
    if (vecinas.length === 0) return

    const temporizadores = vecinas.map((url, indice) =>
      window.setTimeout(() => preloadEquirect(url), 1400 + indice * 1200),
    )
    return () => temporizadores.forEach(window.clearTimeout)
  }, [scene, tour.scenes])

  return (
    <TourEngineProvider value={engine}>
      {/* alto-pantalla, y no la utilidad de dvh a secas: dvh descuenta la barra
          del navegador (por eso la queremos) pero no existe antes de iOS 15.4,
          y una altura inválida deja el contenedor en cero y la pantalla vacía.
          La utilidad de src/index.css hace la escalera de respaldo. */}
      <div className="alto-pantalla relative w-full overflow-hidden bg-black">
        {/* ───────────────────────────── CAPA 0 · el visor 360 ───────────────────────────── */}
        <Escena360
          engine={engine}
          url={scene.image}
          initialYaw={scene.initialYaw ?? 0}
          nivel={scene.nivel}
          webgl={webgl}
          onLoadingChange={setLoading}
          onError={alFallar}
          onPointerDownCapture={alTocar}
        />

        {/* Un lector de pantalla no ve la esfera ni el velo de carga: pasar de
            un cuarto a otro no anunciaba absolutamente nada, así que la app
            parecía congelada justo cuando más está pasando. Este párrafo es lo
            único que la persona oye al cambiar de habitación. Se queda fuera del
            HUD para que no lo alcance el pointer-events-none ni el z-30. */}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {loading
            ? `Cargando ${scene.name}…`
            : `${scene.name}. ${
                scene.hotspots.length === 0
                  ? 'Sin puntos'
                  : `${scene.hotspots.length} ${scene.hotspots.length === 1 ? 'punto' : 'puntos'}`
              }.`}
        </p>

        {/* ───────────────────────────── CAPA 1 · HUD ───────────────────────────── */}
        <div className="pointer-events-none absolute inset-0 z-30" onWheel={zoomRueda}>
          {/* Hotspots: van pegados a la escena pero son DOM de verdad. */}
          <HotspotLayer hotspots={scene.hotspots} onSelect={handleHotspot} />

          {/* Barra superior */}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3
                          pt-[calc(env(safe-area-inset-top)+0.75rem)]">
            <div className="hud-glass pointer-events-auto min-w-0 rounded-hud px-4 py-2.5">
              <p className="truncate text-sm font-semibold text-hud">{tour.title}</p>
              <p className="truncate text-xs text-hud-2">
                {scene.name}
                {tour.subtitle ? ` · ${tour.subtitle}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-start gap-2">
              {accion}
              <Compass className="relative shrink-0" rumbo={scene.rumbo} />
            </div>
          </div>

          {/* Selector de habitaciones, arriba: deja todo el borde inferior libre
              para los pulgares, que es lo que se toca de verdad en un celular. */}
          <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+5.25rem)] px-3">
            <RoomBar scenes={tour.scenes} activeId={scene.id} onSelect={(id) => goToScene(id)} />
          </div>

          {/* El plano de la casa, cuando el recorrido trae uno y la persona lo
              abrió: dónde está parada y hacia dónde mira. Debajo de la barra de
              habitaciones, pegado a la derecha. Tocar un alfiler cambia de
              cuarto por el mismo camino que la barra: sin puerta, sin empuje.
              Ver src/components/ui/Minimapa.tsx y src/lib/planta.ts. */}
          {tour.plano && planoAbierto && (
            <div className="absolute right-3 top-[calc(env(safe-area-inset-top)+9.5rem)] max-w-[calc(100%-1.5rem)]">
              <Minimapa plano={tour.plano} scenes={tour.scenes} activeId={scene.id} onSelect={(id) => goToScene(id)} />
            </div>
          )}

          {/* Joystick · esquina inferior IZQUIERDA, zona del pulgar izquierdo.
              Con el giroscopio encendido se retira: la mano ya es el joystick, y
              dos formas de girar a la vista confunden. El arrastre sigue. */}
          {!sensorActivo && (
            <div className="absolute bottom-0 left-0 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
              <Joystick className="h-40 w-40 sm:h-44 sm:w-44" onChange={handleAxis} />
            </div>
          )}

          {/* Zoom y reencuadre · pulgar derecho */}
          <div className="absolute bottom-0 right-0 flex flex-col items-end gap-2 p-3
                          pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            {/* El plano de la casa: solo si el recorrido trae uno. Abre y cierra
                el minimapa de arriba; `aria-pressed` dice en cuál está. */}
            {tour.plano && (
              <button
                type="button"
                onClick={() => setPlanoAbierto((v) => !v)}
                aria-pressed={planoAbierto}
                aria-label={planoAbierto ? 'Cerrar el plano' : 'Ver el plano'}
                className={`hud-glass pointer-events-auto grid h-11 w-11 place-items-center rounded-2xl
                           transition-colors active:bg-white/15 ${planoAbierto ? 'text-brand-300' : 'text-hud'}`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 5h16v14H4zM4 12h7M11 5v7M15 12v7" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {/* Mirar con el teléfono. No se pinta sin https ni sin el evento en
                el navegador (escritorio): un botón que no puede hacer nada es
                peor que ninguno. Y desaparece si al intentarlo resulta que no
                hay sensores, con el aviso de abajo explicándolo. */}
            {giro.disponible && giro.estado !== 'no-soportado' && (
              <button
                type="button"
                onClick={() => (sensorActivo ? giro.desactivar() : void giro.activar())}
                aria-pressed={sensorActivo}
                aria-label={sensorActivo ? 'Dejar de mirar con el teléfono' : 'Mirar con el teléfono'}
                className={`hud-glass pointer-events-auto grid h-11 w-11 place-items-center rounded-2xl
                           transition-colors active:bg-white/15 ${
                             sensorActivo ? 'text-brand-300' : 'text-hud'
                           }`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="8" y="3" width="8" height="18" rx="2" />
                  <path d="M4.5 8.5a8 8 0 0 0 0 7M19.5 8.5a8 8 0 0 1 0 7" strokeLinecap="round" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={resetView}
              aria-label="Reencuadrar"
              className="hud-glass pointer-events-auto grid h-11 w-11 place-items-center rounded-2xl
                         text-hud transition-colors active:bg-white/15"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 4v3M12 17v3M4 12h3M17 12h3" strokeLinecap="round" />
                <circle cx="12" cy="12" r="5" />
              </svg>
            </button>
            <ZoomControls />
          </div>

          {/* Pista de arranque · por encima de la fila de controles.
              El mismo hueco lo reutiliza el sensor de movimiento para decir qué
              pasó —que se encendió, que Safari negó el permiso, que este
              aparato no tiene sensores—. Reutilizarlo y no inventar un segundo
              cartel es a propósito: los dos textos dicen lo mismo, "así se mira
              alrededor", y nunca hacen falta al mismo tiempo. El aviso gana
              porque es respuesta a un botón que la persona acaba de tocar.

              La píldora se cuadra cuando lleva un aviso: los avisos son de dos
              renglones y en una forma redonda las esquinas se comen el texto. */}
          <div
            className={`absolute bottom-[calc(env(safe-area-inset-bottom)+12rem)] left-1/2 w-[min(20rem,90vw)]
                        -translate-x-1/2 transition-opacity duration-500 ${
                          hintVisible || avisoGiro
                            ? 'opacity-100'
                            : 'pointer-events-none opacity-0'
                        }`}
          >
            <p
              role="status"
              className={`hud-glass px-4 py-2 text-center text-xs leading-relaxed text-hud-2 ${
                avisoGiro ? 'rounded-2xl' : 'rounded-full'
              }`}
            >
              {avisoGiro ?? pista}
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
          <div
            ref={cartelError}
            role="alert"
            tabIndex={-1}
            className="absolute inset-0 z-40 grid place-items-center bg-black/80 p-6 text-center outline-none"
          >
            <div className="max-w-xs">
              <p className="text-sm font-semibold text-ink-50">
                No se pudo cargar la foto de {scene.name}
              </p>
              {/* La ruta interna (una URL blob: de cuarenta caracteres) no le
                  dice nada a nadie; lo que sirve es qué hacer. */}
              <p className="mt-2 text-xs leading-relaxed text-ink-200">
                Si el recorrido lo hiciste en este teléfono, vuelve a tomar la foto de esa
                habitación desde el editor. Si tienes el archivo <b>.tour</b> que exportaste,
                ábrelo otra vez.
              </p>
            </div>
          </div>
        )}

        {info && <InfoSheet title={info.title} body={info.body} onClose={() => setInfo(null)} />}
      </div>
    </TourEngineProvider>
  )
}

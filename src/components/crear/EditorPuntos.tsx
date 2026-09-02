/* oxlint-disable react/set-state-in-effect, react/immutability -- Los efectos
   sincronizan con IndexedDB y el engine es mutable a propósito. Ver la nota de
   arquitectura en src/lib/tourEngine.ts */
import { useCallback, useEffect, useRef, useState } from 'react'

import { useWheelZoom } from '../../lib/useDragLook'
import type { Ruta } from '../../lib/useHashRoute'
import type { Hotspot } from '../../lib/types'
import type { StoredScene, StoredTour } from '../../lib/store/types'
import { getTour, saveTour } from '../../lib/store/tours'
import { newId } from '../../lib/store/ids'
import { useBlobUrl } from '../../lib/store/useBlobUrl'
import { TourEngineProvider, useCreateTourEngine } from '../../lib/tourEngine'
import { wrap180 } from '../../lib/math'
import { screenToYawPitch } from '../../lib/math3d'

import { BASE_FOV, Escena360, detectWebGL } from '../tour/Escena360'
import { Compass } from '../ui/Compass'
import { LoadingVeil } from '../ui/LoadingVeil'
import { Aviso, Boton, Campo, Cargando, Hoja, Pantalla } from './ui'
import { PuntosEditables } from './PuntosEditables'

export type EditorPuntosProps = {
  tourId: string
  sceneId: string
  ir: (ruta: Ruta) => void
}

type Borrador = {
  id: string
  kind: 'link' | 'info'
  label: string
  to: string
  body: string
  yaw: number
  pitch: number
  nuevo: boolean
}

/**
 * ============================================================================
 *  COLOCAR LOS PUNTOS
 * ============================================================================
 *
 * Es el visor de siempre con otro HUD encima. Hay dos formas de poner un punto,
 * a propósito:
 *
 *   · Con la MIRA: apuntas la escena y tocas el botón. En un celular a una
 *     mano, apuntar y tocar un botón grande abajo es mucho más preciso que
 *     estirar el pulgar hasta un lugar exacto de la foto.
 *   · TOCANDO la foto: se entra a ese modo con un botón, no está siempre
 *     encendido. Si lo estuviera, cada toque para mirar alrededor crearía un
 *     punto por accidente.
 *
 * Y una vez puesto, se arrastra.
 */
export function EditorPuntos({ tourId, sceneId, ir }: EditorPuntosProps) {
  const engine = useCreateTourEngine()
  /* La rueda también sobre el HUD: ver useWheelZoom en src/lib/useDragLook.ts */
  const zoomRueda = useWheelZoom(engine)
  const [webgl] = useState(detectWebGL)

  const [tour, setTour] = useState<StoredTour | null | 'no-existe'>(null)
  const [cargando, setCargando] = useState(true)
  const [seleccion, setSeleccion] = useState<string | null>(null)
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const [modoTocar, setModoTocar] = useState(false)
  const [guardado, setGuardado] = useState<string | null>(null)

  const capa = useRef<HTMLDivElement>(null)

  const escena: StoredScene | null =
    tour && tour !== 'no-existe' ? (tour.scenes.find((s) => s.id === sceneId) ?? null) : null

  const url = useBlobUrl(escena?.imageId)

  useEffect(() => {
    void getTour(tourId).then((t) => setTour(t ?? 'no-existe'))
  }, [tourId])

  const aplicar = useCallback(
    async (cambiar: (scene: StoredScene) => StoredScene, aviso?: string) => {
      if (!tour || tour === 'no-existe' || !escena) return
      const siguiente: StoredTour = {
        ...tour,
        scenes: tour.scenes.map((s) => (s.id === sceneId ? cambiar(s) : s)),
      }
      setTour(siguiente)
      await saveTour(siguiente)
      if (aviso) {
        setGuardado(aviso)
        window.setTimeout(() => setGuardado(null), 1800)
      }
    },
    [escena, sceneId, tour],
  )

  /** Mientras se arrastra solo se actualiza en memoria; al soltar se guarda. */
  const mover = useCallback(
    (id: string, yaw: number, pitch: number, final: boolean) => {
      if (!tour || tour === 'no-existe') return
      const actualizar = (scene: StoredScene): StoredScene => ({
        ...scene,
        hotspots: scene.hotspots.map((h) =>
          h.id === id ? { ...h, yaw: wrap180(yaw), pitch } : h,
        ),
      })
      if (final) {
        void aplicar(actualizar, 'Punto movido')
      } else {
        setTour({
          ...tour,
          scenes: tour.scenes.map((s) => (s.id === sceneId ? actualizar(s) : s)),
        })
      }
    },
    [aplicar, sceneId, tour],
  )

  const nuevoBorrador = (yaw: number, pitch: number): Borrador => ({
    id: newId('punto'),
    kind: tour !== 'no-existe' && tour && tour.scenes.length > 1 ? 'link' : 'info',
    label: '',
    to: tour !== 'no-existe' && tour ? (tour.scenes.find((s) => s.id !== sceneId)?.id ?? '') : '',
    body: '',
    yaw: wrap180(yaw),
    pitch,
    nuevo: true,
  })

  const alTocarFoto = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!modoTocar) return
    const caja = capa.current
    if (!caja) return
    const rect = caja.getBoundingClientRect()
    const { yaw, pitch } = screenToYawPitch(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      engine.readout,
    )
    setModoTocar(false)
    setBorrador(nuevoBorrador(yaw, pitch))
  }

  const guardarPunto = async () => {
    if (!borrador || !escena) return
    const base = {
      id: borrador.id,
      label: borrador.label.trim() || (borrador.kind === 'link' ? 'Ir' : 'Nota'),
      yaw: borrador.yaw,
      pitch: borrador.pitch,
    }
    const hotspot: Hotspot =
      borrador.kind === 'link'
        ? { ...base, kind: 'link', to: borrador.to }
        : { ...base, kind: 'info', body: borrador.body.trim() || undefined }

    await aplicar(
      (scene) => ({
        ...scene,
        hotspots: borrador.nuevo
          ? [...scene.hotspots, hotspot]
          : scene.hotspots.map((h) => (h.id === hotspot.id ? hotspot : h)),
      }),
      borrador.nuevo ? 'Punto agregado' : 'Punto guardado',
    )
    setBorrador(null)
    setSeleccion(hotspot.id)
  }

  const borrarPunto = async () => {
    if (!borrador) return
    await aplicar(
      (scene) => ({ ...scene, hotspots: scene.hotspots.filter((h) => h.id !== borrador.id) }),
      'Punto borrado',
    )
    setBorrador(null)
    setSeleccion(null)
  }

  const editar = (id: string) => {
    const hotspot = escena?.hotspots.find((h) => h.id === id)
    if (!hotspot) return
    setBorrador({
      id: hotspot.id,
      kind: hotspot.kind,
      label: hotspot.label,
      to: hotspot.kind === 'link' ? hotspot.to : '',
      body: hotspot.kind === 'info' ? (hotspot.body ?? '') : '',
      yaw: hotspot.yaw,
      pitch: hotspot.pitch,
      nuevo: false,
    })
  }

  if (tour === null) {
    return (
      <Pantalla titulo="Puntos" atras={() => ir({ nombre: 'editar', tourId })}>
        <Cargando />
      </Pantalla>
    )
  }

  if (tour === 'no-existe' || !escena) {
    return (
      <Pantalla titulo="Puntos" atras={() => ir({ nombre: 'editar', tourId })}>
        <Aviso tono="error" titulo="No se encontró la habitación">
          Puede que se haya borrado. Regresa al recorrido y vuelve a entrar.
        </Aviso>
      </Pantalla>
    )
  }

  const otras = tour.scenes.filter((s) => s.id !== sceneId)

  return (
    <TourEngineProvider value={engine}>
      <div className="alto-pantalla relative w-full overflow-hidden bg-black">
        {url && (
          <Escena360
            engine={engine}
            url={url}
            initialYaw={escena.initialYaw ?? 0}
            webgl={webgl}
            onLoadingChange={setCargando}
          />
        )}

        {/* Capa que recibe el toque para colocar. Solo intercepta cuando el modo
            está encendido; el resto del tiempo deja pasar el dedo al arrastre. */}
        <div
          ref={capa}
          onPointerUp={alTocarFoto}
          className={`absolute inset-0 z-20 ${modoTocar ? 'cursor-crosshair' : 'pointer-events-none'}`}
        />

        {/* Sombra de abajo: sin ella, los botones sobre una pared blanca
            quedan ilegibles. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-56
                        bg-gradient-to-t from-black/75 via-black/35 to-transparent" />

        <div className="pointer-events-none absolute inset-0 z-30" onWheel={zoomRueda}>
          <PuntosEditables
            hotspots={escena.hotspots}
            seleccionado={seleccion}
            onSeleccionar={setSeleccion}
            onMover={mover}
          />

          {/* Mira central */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="h-10 w-10 rounded-full border-2 border-white/70 shadow-lg" />
            <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
          </div>

          {/* Barra superior */}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3
                          pt-[calc(env(safe-area-inset-top)+0.75rem)]">
            <button
              type="button"
              onClick={() => ir({ nombre: 'editar', tourId })}
              className="hud-glass pointer-events-auto grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-50"
              aria-label="Regresar"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="hud-glass pointer-events-auto min-w-0 flex-1 rounded-hud px-4 py-2.5">
              <p className="truncate text-sm font-semibold text-ink-50">{escena.name}</p>
              <p className="truncate text-xs text-ink-200">
                {escena.hotspots.length === 0
                  ? 'Sin puntos todavía'
                  : `${escena.hotspots.length} ${escena.hotspots.length === 1 ? 'punto' : 'puntos'}`}
              </p>
            </div>
            <Compass className="relative shrink-0" rumbo={escena.rumbo} />
          </div>

          {guardado && (
            <div className="absolute left-1/2 top-[calc(env(safe-area-inset-top)+5.5rem)] -translate-x-1/2">
              <p className="hud-glass rounded-full px-4 py-1.5 text-xs text-ink-50">{guardado}</p>
            </div>
          )}

          {modoTocar && (
            <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+5.5rem)] px-3">
              <p className="hud-glass mx-auto w-fit rounded-full px-4 py-2 text-center text-xs text-brand-300">
                Toca la foto donde quieres el punto
              </p>
            </div>
          )}

          {/* Controles de abajo */}
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-3
                          pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
            {seleccion && escena.hotspots.some((h) => h.id === seleccion) && (
              <div className="pointer-events-auto flex gap-2">
                <Boton ancho onClick={() => editar(seleccion)}>
                  Editar el punto
                </Boton>
              </div>
            )}

            <div className="pointer-events-auto flex gap-2">
              <Boton
                tipo="principal"
                ancho
                onClick={() =>
                  setBorrador(nuevoBorrador(engine.readout.yaw, engine.readout.pitch))
                }
              >
                Poner punto en la mira
              </Boton>
              <Boton onClick={() => setModoTocar((v) => !v)}>{modoTocar ? 'Cancelar' : 'Tocar'}</Boton>
            </div>

            <div className="pointer-events-auto flex gap-2">
              <Boton
                ancho
                onClick={() =>
                  void aplicar(
                    (scene) => ({ ...scene, initialYaw: wrap180(engine.readout.yaw) }),
                    'Así se va a ver al entrar',
                  )
                }
              >
                Usar esta vista al entrar
              </Boton>
              <Boton
                onClick={() => {
                  engine.input.goto = { yaw: escena.initialYaw ?? 0, pitch: 0 }
                  engine.input.gotoFov = BASE_FOV
                  engine.invalidar()
                }}
              >
                Centrar
              </Boton>
            </div>
          </div>
        </div>

        <LoadingVeil visible={cargando && !!url} />
        {!url && <LoadingVeil visible label="Abriendo la habitación…" />}

        {borrador && (
          <Hoja
            titulo={borrador.nuevo ? 'Punto nuevo' : 'Editar punto'}
            onCerrar={() => setBorrador(null)}
          >
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setBorrador({
                      ...borrador,
                      kind: 'link',
                      // Sin destino, el punto se guarda apuntando a nada y el
                      // visor lo descarta: desaparece sin decir por qué.
                      to: borrador.to || (otras[0]?.id ?? ''),
                    })
                  }
                  disabled={otras.length === 0}
                  className={`rounded-2xl border p-3 text-left text-sm disabled:opacity-40 ${
                    borrador.kind === 'link'
                      ? 'border-brand-500 bg-brand-500/10'
                      : 'border-white/10 bg-white/5'
                  }`}
                >
                  <b className="block">Ir a otro cuarto</b>
                  <span className="text-xs text-ink-200">
                    {otras.length === 0 ? 'Necesitas otra habitación' : 'Una puerta o un pasillo'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setBorrador({ ...borrador, kind: 'info' })}
                  className={`rounded-2xl border p-3 text-left text-sm ${
                    borrador.kind === 'info'
                      ? 'border-brand-500 bg-brand-500/10'
                      : 'border-white/10 bg-white/5'
                  }`}
                >
                  <b className="block">Solo un dato</b>
                  <span className="text-xs text-ink-200">Medidas, acabados, notas</span>
                </button>
              </div>

              <Campo
                etiqueta="Qué dice el punto"
                valor={borrador.label}
                onChange={(label) => setBorrador({ ...borrador, label })}
                placeholder={borrador.kind === 'link' ? 'Cocina' : 'Sala 4.2 × 3.8 m'}
                maxLength={40}
              />

              {borrador.kind === 'link' ? (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink-200">
                    ¿A dónde lleva?
                  </span>
                  <select
                    value={borrador.to}
                    onChange={(e) => setBorrador({ ...borrador, to: e.target.value })}
                    className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-ink-50 outline-none focus:border-brand-500"
                  >
                    {otras.map((s) => (
                      <option key={s.id} value={s.id} className="bg-ink-900">
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <Campo
                  etiqueta="Texto (opcional)"
                  valor={borrador.body}
                  onChange={(body) => setBorrador({ ...borrador, body })}
                  placeholder="Doble altura, salida a patio."
                  multilinea
                  maxLength={280}
                />
              )}

              <p className="text-xs text-ink-200/70">
                Queda en {Math.round(borrador.yaw)}° / {Math.round(borrador.pitch)}°. Después lo
                puedes arrastrar con el dedo.
              </p>

              <Boton
                tipo="principal"
                ancho
                onClick={() => void guardarPunto()}
                disabled={borrador.kind === 'link' && !borrador.to}
              >
                {borrador.nuevo ? 'Agregar' : 'Guardar'}
              </Boton>
              {!borrador.nuevo && (
                <Boton tipo="peligro" ancho onClick={() => void borrarPunto()}>
                  Borrar el punto
                </Boton>
              )}
            </div>
          </Hoja>
        )}
      </div>
    </TourEngineProvider>
  )
}

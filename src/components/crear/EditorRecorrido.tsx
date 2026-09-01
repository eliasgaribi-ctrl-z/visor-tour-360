/* oxlint-disable react/set-state-in-effect -- Los efectos sincronizan con
   IndexedDB, que es un sistema externo. */
import { useCallback, useEffect, useState } from 'react'

import type { Ruta } from '../../lib/useHashRoute'
import type { StoredScene, StoredTour } from '../../lib/store/types'
import { blobUrl, deleteImage, getTour, saveTour } from '../../lib/store/tours'
import { entregarArchivo, exportarTour, PaqueteError } from '../../lib/store/paquete'
import { contextoSeguro } from '../../lib/capture/camera'
import { Aviso, Boton, Campo, Cargando, Hoja, Pantalla, Tarjeta } from './ui'

export type EditorRecorridoProps = {
  tourId: string
  ir: (ruta: Ruta) => void
}

function Miniatura({ scene }: { scene: StoredScene }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    void blobUrl(scene.thumbId ?? scene.imageId).then((u) => {
      if (vivo) setUrl(u)
    })
    return () => {
      vivo = false
    }
  }, [scene.thumbId, scene.imageId])

  return (
    <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-black/40">
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
    </div>
  )
}

export function EditorRecorrido({ tourId, ir }: EditorRecorridoProps) {
  const [tour, setTour] = useState<StoredTour | null | 'no-existe'>(null)
  const [editando, setEditando] = useState<StoredScene | null>(null)
  const [agregando, setAgregando] = useState(false)
  const [datos, setDatos] = useState(false)
  const [paquete, setPaquete] = useState<
    { estado: 'armando' } | { estado: 'listo'; blob: Blob; nombre: string } | { estado: 'error'; mensaje: string } | null
  >(null)

  const cargar = useCallback(async () => {
    const encontrado = await getTour(tourId)
    setTour(encontrado ?? 'no-existe')
  }, [tourId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const guardar = async (siguiente: StoredTour) => {
    const guardado = await saveTour(siguiente)
    setTour(guardado)
  }

  if (tour === null) {
    return (
      <Pantalla titulo="Recorrido" atras={() => ir({ nombre: 'inicio' })}>
        <Cargando />
      </Pantalla>
    )
  }

  if (tour === 'no-existe') {
    return (
      <Pantalla titulo="Recorrido" atras={() => ir({ nombre: 'inicio' })}>
        <Aviso tono="error" titulo="Ya no está">
          Este recorrido no está guardado en este teléfono. Puede que se haya borrado o que lo
          hayas creado en otro dispositivo.
        </Aviso>
      </Pantalla>
    )
  }

  const mover = (indice: number, direccion: -1 | 1) => {
    const destino = indice + direccion
    if (destino < 0 || destino >= tour.scenes.length) return
    const scenes = [...tour.scenes]
    ;[scenes[indice], scenes[destino]] = [scenes[destino], scenes[indice]]
    void guardar({ ...tour, scenes })
  }

  const borrarEscena = async (scene: StoredScene) => {
    const scenes = tour.scenes.filter((s) => s.id !== scene.id)
    // Los puntos que llevaban a esa habitación quedarían sin destino.
    const limpias = scenes.map((s) => ({
      ...s,
      hotspots: s.hotspots.filter((h) => h.kind !== 'link' || h.to !== scene.id),
    }))
    await guardar({
      ...tour,
      scenes: limpias,
      startSceneId: tour.startSceneId === scene.id ? (limpias[0]?.id ?? '') : tour.startSceneId,
    })
    await deleteImage(scene.imageId)
    if (scene.thumbId) await deleteImage(scene.thumbId)
    setEditando(null)
  }

  const prepararArchivo = async () => {
    setPaquete({ estado: 'armando' })
    try {
      const { blob, nombre } = await exportarTour(tour.id)
      setPaquete({ estado: 'listo', blob, nombre })
    } catch (e) {
      setPaquete({
        estado: 'error',
        mensaje:
          e instanceof PaqueteError
            ? [e.message, e.consejo].filter(Boolean).join(' ')
            : 'No se pudo armar el archivo.',
      })
    }
  }

  const listo = tour.scenes.length > 0

  return (
    <Pantalla
      titulo={tour.title}
      subtitulo={`${tour.scenes.length} ${tour.scenes.length === 1 ? 'habitación' : 'habitaciones'}`}
      atras={() => ir({ nombre: 'inicio' })}
      accion={
        listo ? (
          <Boton tipo="fantasma" onClick={() => ir({ nombre: 'ver', tourId: tour.id })}>
            Ver
          </Boton>
        ) : undefined
      }
    >
      <div className="mx-auto flex w-full max-w-md flex-col gap-3">
        {tour.scenes.length === 0 && (
          <Aviso titulo="Empieza por la sala">
            Párate en medio del cuarto, agrega la habitación y ve girando despacio sobre tu propio
            eje. Cuando tengas dos o más cuartos, podrás poner las puertas para pasar de uno a otro.
          </Aviso>
        )}

        <Boton tipo="principal" ancho onClick={() => setAgregando(true)}>
          Agregar habitación
        </Boton>

        {tour.scenes.map((scene, indice) => (
          <Tarjeta key={scene.id}>
            <div className="flex items-center gap-3">
              <Miniatura scene={scene} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{scene.name}</p>
                <p className="text-xs text-ink-200">
                  {scene.id === tour.startSceneId && (
                    <span className="text-brand-300">entrada · </span>
                  )}
                  {scene.hotspots.length === 0
                    ? 'sin puntos'
                    : `${scene.hotspots.length} ${scene.hotspots.length === 1 ? 'punto' : 'puntos'}`}
                  {scene.coverageDeg !== undefined && scene.coverageDeg < 340 && (
                    <span className="text-brand-300"> · foto parcial</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  aria-label="Subir"
                  onClick={() => mover(indice, -1)}
                  disabled={indice === 0}
                  className="grid h-7 w-8 place-items-center rounded-md bg-white/10 text-xs disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="Bajar"
                  onClick={() => mover(indice, 1)}
                  disabled={indice === tour.scenes.length - 1}
                  className="grid h-7 w-8 place-items-center rounded-md bg-white/10 text-xs disabled:opacity-30"
                >
                  ↓
                </button>
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              <Boton ancho onClick={() => ir({ nombre: 'puntos', tourId: tour.id, sceneId: scene.id })}>
                Puntos y vista
              </Boton>
              <Boton tipo="fantasma" onClick={() => setEditando(scene)}>
                Ajustes
              </Boton>
            </div>
          </Tarjeta>
        ))}

        {listo && (
          <>
            <div className="mt-2 h-px bg-white/10" />
            <Tarjeta>
              <p className="mb-1 font-semibold">Guardar una copia</p>
              <p className="mb-3 text-sm text-ink-200">
                Genera un archivo con el recorrido y sus fotos. Sirve de respaldo y para pasarlo a
                otro teléfono.
              </p>
              {paquete?.estado === 'listo' ? (
                <Boton
                  tipo="principal"
                  ancho
                  onClick={() => entregarArchivo(paquete.blob, paquete.nombre)}
                >
                  Compartir {paquete.nombre}
                </Boton>
              ) : (
                <Boton ancho onClick={() => void prepararArchivo()} disabled={paquete?.estado === 'armando'}>
                  {paquete?.estado === 'armando' ? 'Armando el archivo…' : 'Preparar archivo'}
                </Boton>
              )}
              {paquete?.estado === 'error' && (
                <p className="mt-2 text-sm text-red-300">{paquete.mensaje}</p>
              )}
            </Tarjeta>
          </>
        )}

        <Boton tipo="fantasma" ancho onClick={() => setDatos(true)}>
          Cambiar el nombre del recorrido
        </Boton>
      </div>

      {agregando && (
        <Hoja titulo="¿Cómo quieres la foto?" onCerrar={() => setAgregando(false)}>
          <div className="flex flex-col gap-2">
            <Boton
              tipo="principal"
              ancho
              onClick={() => ir({ nombre: 'capturar', tourId: tour.id })}
              disabled={!contextoSeguro()}
            >
              Tomarla con la cámara
            </Boton>
            <p className="px-1 text-xs text-ink-200">
              {contextoSeguro()
                ? 'Giras sobre tu propio eje siguiendo unos puntos y el visor arma la foto 360 solo.'
                : 'No disponible: para usar la cámara el visor tiene que abrirse con https.'}
            </p>

            <Boton ancho onClick={() => ir({ nombre: 'foto', tourId: tour.id })}>
              Usar una foto que ya tengo
            </Boton>
            <p className="px-1 text-xs text-ink-200">
              Una foto 360, una panorámica del celular o una foto normal.
            </p>
          </div>
        </Hoja>
      )}

      {datos && (
        <Hoja titulo="Datos del recorrido" onCerrar={() => setDatos(false)}>
          <div className="flex flex-col gap-3">
            <Campo
              etiqueta="Nombre"
              valor={tour.title}
              onChange={(title) => setTour({ ...tour, title })}
              maxLength={60}
            />
            <Campo
              etiqueta="Renglón de abajo (opcional)"
              valor={tour.subtitle ?? ''}
              onChange={(subtitle) => setTour({ ...tour, subtitle })}
              placeholder="3 recámaras · 120 m²"
              maxLength={80}
            />
            <Boton
              tipo="principal"
              ancho
              onClick={async () => {
                await guardar(tour)
                setDatos(false)
              }}
            >
              Guardar
            </Boton>
          </div>
        </Hoja>
      )}

      {editando && (
        <Hoja titulo={editando.name} onCerrar={() => setEditando(null)}>
          <div className="flex flex-col gap-3">
            <Campo
              etiqueta="Nombre de la habitación"
              valor={editando.name}
              onChange={(name) => setEditando({ ...editando, name })}
              maxLength={40}
            />
            <Boton
              tipo="principal"
              ancho
              onClick={async () => {
                await guardar({
                  ...tour,
                  scenes: tour.scenes.map((s) => (s.id === editando.id ? editando : s)),
                })
                setEditando(null)
              }}
            >
              Guardar
            </Boton>
            <div className="flex gap-2">
              <Boton
                ancho
                onClick={() => ir({ nombre: 'capturar', tourId: tour.id, sceneId: editando.id })}
                disabled={!contextoSeguro()}
              >
                Volver a tomarla
              </Boton>
              <Boton
                ancho
                onClick={() => ir({ nombre: 'foto', tourId: tour.id, sceneId: editando.id })}
              >
                Cambiar la foto
              </Boton>
            </div>
            <p className="-mt-1 px-1 text-xs text-ink-200">
              La foto se reemplaza; el nombre y los puntos de esta habitación se quedan como están.
            </p>

            {editando.id !== tour.startSceneId && (
              <Boton
                ancho
                onClick={async () => {
                  await guardar({ ...tour, startSceneId: editando.id })
                  setEditando(null)
                }}
              >
                Que el recorrido empiece aquí
              </Boton>
            )}
            <Boton tipo="peligro" ancho onClick={() => void borrarEscena(editando)}>
              Borrar la habitación
            </Boton>
          </div>
        </Hoja>
      )}
    </Pantalla>
  )
}

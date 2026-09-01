/* oxlint-disable react/set-state-in-effect -- Los efectos sincronizan con
   IndexedDB, que es un sistema externo. */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Ruta } from '../../lib/useHashRoute'
import type { TourSummary } from '../../lib/store/types'
import {
  blobUrl,
  createTour,
  deleteTour,
  listTours,
  saveTour,
} from '../../lib/store/tours'
import { almacenamientoUtilizable } from '../../lib/store/tours'
import { formatBytes, requestPersistence, storageInfo } from '../../lib/store/quota'
import { importarTour, PaqueteError } from '../../lib/store/paquete'
import { Aviso, Boton, Campo, Cargando, Hoja, Pantalla, Tarjeta } from './ui'

export type InicioProps = {
  ir: (ruta: Ruta) => void
}

/** Fecha corta y en español: "hoy", "ayer", "12 de agosto". */
function cuando(ms: number): string {
  const dia = 24 * 60 * 60 * 1000
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const diferencia = Math.floor((hoy.getTime() - new Date(ms).setHours(0, 0, 0, 0)) / dia)
  if (diferencia <= 0) return 'hoy'
  if (diferencia === 1) return 'ayer'
  if (diferencia < 7) return `hace ${diferencia} días`
  return new Date(ms).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })
}

function Portada({ coverId }: { coverId?: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    if (!coverId) {
      setUrl(null)
      return
    }
    void blobUrl(coverId).then((u) => {
      if (vivo) setUrl(u)
    })
    return () => {
      vivo = false
    }
  }, [coverId])

  return (
    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-black/40">
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
    </div>
  )
}

export function Inicio({ ir }: InicioProps) {
  const [tours, setTours] = useState<TourSummary[] | null>(null)
  const [nuevo, setNuevo] = useState<string | null>(null)
  const [borrando, setBorrando] = useState<TourSummary | null>(null)
  const [espacio, setEspacio] = useState<{ texto: string; persistente: boolean } | null>(null)
  const [sePuedeGuardar, setSePuedeGuardar] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [importando, setImportando] = useState(false)
  const [creando, setCreando] = useState(false)
  const archivo = useRef<HTMLInputElement>(null)

  const recargar = useCallback(async () => {
    try {
      setTours(await listTours())
    } catch (e) {
      setTours([])
      setError(e instanceof Error ? e.message : 'No se pudieron leer los recorridos guardados.')
    }
  }, [])

  useEffect(() => {
    void recargar()
  }, [recargar])

  useEffect(() => {
    void (async () => {
      const info = await storageInfo()
      setEspacio({
        texto:
          info.usage !== undefined && info.quota !== undefined
            ? `${formatBytes(info.usage)} usados de ${formatBytes(info.quota)}`
            : '',
        persistente: info.persistent,
      })
      setSePuedeGuardar(await almacenamientoUtilizable())
    })()
  }, [])

  const crear = async (titulo: string) => {
    // En un celular, el doble toque sobre un botón que no responde al instante
    // es el gesto normal; sin esto quedan dos recorridos vacíos.
    if (creando) return
    setCreando(true)
    let tour
    try {
      tour = await saveTour(createTour(titulo))
    } catch (e) {
      setCreando(false)
      setError(e instanceof Error ? e.message : 'No se pudo crear el recorrido.')
      return
    }
    setNuevo(null)
    setCreando(false)
    // Al primer guardado se pide que el navegador no borre los datos. Tiene que
    // ser dentro de la interacción del usuario para que Chrome lo conceda.
    void requestPersistence()
    ir({ nombre: 'editar', tourId: tour.id })
  }

  const abrirArchivo = async (file: File) => {
    setImportando(true)
    setError(null)
    try {
      const tour = await importarTour(file)
      await recargar()
      ir({ nombre: 'editar', tourId: tour.id })
    } catch (e) {
      const mensaje = e instanceof PaqueteError ? [e.message, e.consejo].filter(Boolean).join(' ') : 'No se pudo abrir el archivo.'
      setError(mensaje)
    } finally {
      setImportando(false)
      if (archivo.current) archivo.current.value = ''
    }
  }

  return (
    <Pantalla
      titulo="Mis recorridos"
      subtitulo={espacio?.texto || undefined}
      accion={
        <Boton tipo="fantasma" onClick={() => ir({ nombre: 'demo' })}>
          Ejemplo
        </Boton>
      }
    >
      <div className="mx-auto flex w-full max-w-md flex-col gap-3">
        {!sePuedeGuardar && (
          <Aviso tono="error" titulo="Aquí no se puede guardar">
            El navegador está en modo privado o tiene bloqueado el almacenamiento, así que un
            recorrido nuevo se perdería al cerrar la pestaña. Abre el visor en una ventana normal.
          </Aviso>
        )}

        {error && (
          <Aviso tono="error" titulo="Algo salió mal">
            {error}
          </Aviso>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Boton tipo="principal" ancho onClick={() => setNuevo('')}>
            Nuevo recorrido
          </Boton>
          <Boton ancho onClick={() => archivo.current?.click()} disabled={importando}>
            {importando ? 'Abriendo…' : 'Abrir archivo'}
          </Boton>
        </div>

        <input
          ref={archivo}
          type="file"
          accept=".tour,.zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void abrirArchivo(file)
          }}
        />

        {tours === null ? (
          <Cargando texto="Buscando tus recorridos…" />
        ) : tours.length === 0 ? (
          <Tarjeta>
            <p className="text-sm text-ink-200">
              Todavía no tienes recorridos. Toca <b className="text-ink-50">Nuevo recorrido</b>,
              ponle el nombre de la casa y ve tomando una foto 360 por cuarto.
            </p>
          </Tarjeta>
        ) : (
          tours.map((tour) => (
            <div key={tour.id} className="flex items-stretch gap-2">
              <div className="min-w-0 flex-1">
                <Tarjeta onClick={() => ir({ nombre: 'editar', tourId: tour.id })}>
                  <div className="flex items-center gap-3">
                    <Portada coverId={tour.coverId} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{tour.title}</p>
                      <p className="text-xs text-ink-200">
                        {tour.scenes === 0
                          ? 'sin habitaciones'
                          : `${tour.scenes} ${tour.scenes === 1 ? 'habitación' : 'habitaciones'}`}
                        {' · '}
                        {cuando(tour.updatedAt)}
                      </p>
                    </div>
                  </div>
                </Tarjeta>
              </div>
              <button
                type="button"
                aria-label={`Borrar ${tour.title}`}
                onClick={() => setBorrando(tour)}
                className="grid w-12 shrink-0 place-items-center rounded-hud border border-white/10
                           bg-white/5 text-ink-200 active:bg-red-500/20 active:text-red-300"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))
        )}

        {espacio && !espacio.persistente && tours && tours.length > 0 && (
          <Aviso tono="alerta" titulo="Guarda una copia">
            El navegador puede borrar lo que está guardado en el teléfono si se queda sin espacio o
            si pasas varios días sin abrir el visor. Exporta cada recorrido a un archivo desde su
            pantalla y guárdalo donde no se pierda.
          </Aviso>
        )}
      </div>

      {nuevo !== null && (
        <Hoja titulo="Recorrido nuevo" onCerrar={() => setNuevo(null)}>
          <div className="flex flex-col gap-3">
            <Campo
              etiqueta="¿De qué es el recorrido?"
              valor={nuevo}
              onChange={setNuevo}
              placeholder="Casa en Tlajomulco"
              maxLength={60}
              ayuda="Es lo que se ve arriba mientras alguien recorre la casa."
            />
            <Boton
              tipo="principal"
              ancho
              onClick={() => void crear(nuevo)}
              disabled={!nuevo.trim() || creando}
            >
              {creando ? 'Creando…' : 'Crear'}
            </Boton>
          </div>
        </Hoja>
      )}

      {borrando && (
        <Hoja titulo="¿Borrar el recorrido?" onCerrar={() => setBorrando(null)}>
          <p className="mb-4 text-sm text-ink-200">
            Se va a borrar <b className="text-ink-50">{borrando.title}</b> con todas sus fotos, de
            este teléfono. Si tienes el archivo exportado, ese no se toca.
          </p>
          <div className="flex gap-2">
            <Boton ancho onClick={() => setBorrando(null)}>
              Mejor no
            </Boton>
            <Boton
              tipo="peligro"
              ancho
              onClick={async () => {
                await deleteTour(borrando.id)
                setBorrando(null)
                await recargar()
              }}
            >
              Sí, borrar
            </Boton>
          </div>
        </Hoja>
      )}
    </Pantalla>
  )
}

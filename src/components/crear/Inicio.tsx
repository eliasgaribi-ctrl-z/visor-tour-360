/* oxlint-disable react/set-state-in-effect -- Los efectos sincronizan con
   IndexedDB, que es un sistema externo. */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Ruta } from '../../lib/useHashRoute'
import type { TourSummary } from '../../lib/store/types'
import {
  createTour,
  deleteTour,
  listTours,
  saveTour,
} from '../../lib/store/tours'
import { almacenamientoUtilizable } from '../../lib/store/tours'
import { formatBytes, requestPersistence, storageInfo } from '../../lib/store/quota'
import { mensajeDePaquete } from '../../lib/store/entregar'
import { useBlobUrl } from '../../lib/store/useBlobUrl'
import { sePuedePublicar } from '../../lib/publicar'
import { Aviso, Boton, Campo, Cargando, Hoja, Pantalla, Tarjeta } from './ui'

export type InicioProps = {
  ir: (ruta: Ruta) => void
}

/* 400 MB: un recorrido de veinte habitaciones a 8 MP pesa unos 60 MB, así que
   el tope deja pasar con holgura cualquier casa de verdad y corta lo que solo
   puede ser un archivo equivocado o un intento de tumbar la pestaña. */
const MAX_ARCHIVO = 400 * 1024 * 1024

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

/**
 * ============================================================================
 *  A DÓNDE LLEVA UN RECORRIDO DE LA LISTA
 * ============================================================================
 *
 * Al visor, no al editor. Suena obvio y no lo era: hasta ahora la tarjeta y el
 * importador de `.tour` llevaban los dos a `#/editar/<id>`, y el único camino a
 * `#/ver/<id>` en toda la app era el botón "Ver" de la barra del editor.
 *
 * O sea que quien recibe el `.tour` por WhatsApp —el desconocido para el que se
 * construyó la portada— caía en la pantalla de administración: "Borrar la
 * habitación", "Preparar archivo", "Quitar la portada". Nunca veía el precio ni
 * el botón de llamar al agente. Y el agente que quiere enseñarle la casa a un
 * cliente que tiene al lado pasaba obligatoriamente por ahí, con los botones de
 * borrar a la vista.
 *
 * La excepción es un recorrido sin ninguna habitación: ahí no hay nada que ver
 * y mandarlo al visor solo sirve para que rebote en "Todavía no hay nada". Ese
 * va al editor, que es donde de verdad tiene algo que hacer.
 *
 * Y para que el agente no pague dos toques —ni la descarga del motor 3D— cada
 * vez que quiere editar, la fila tiene su propio lápiz al lado del bote de
 * basura. Editar sigue estando a un toque; lo que cambió es cuál es el toque
 * por omisión.
 */
function destinoDe(tourId: string, habitaciones: number): Ruta {
  return habitaciones > 0 ? { nombre: 'ver', tourId } : { nombre: 'editar', tourId }
}

function Portada({ coverId }: { coverId?: string }) {
  const url = useBlobUrl(coverId)

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
  /* Borrar también puede fallar (la base bloqueada por otra pestaña, el disco
     lleno) y hasta ahora la hoja se cerraba igual: el recorrido reaparecía en la
     lista al recargar y no había nada que dijera por qué. */
  const [borrandoAhora, setBorrandoAhora] = useState(false)
  const [errorBorrado, setErrorBorrado] = useState<string | null>(null)
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

  const quitar = async (id: string) => {
    setBorrandoAhora(true)
    setErrorBorrado(null)
    try {
      await deleteTour(id)
      return true
    } catch (e) {
      setErrorBorrado(e instanceof Error ? e.message : 'No se pudo borrar el recorrido.')
      return false
    } finally {
      setBorrandoAhora(false)
    }
  }

  const abrirArchivo = async (file: File) => {
    /* Se mira el tamaño ANTES de tocar el archivo. Abrir un .tour obliga a
       tenerlo entero en memoria dos veces —el zip comprimido y las fotos ya
       descomprimidas— y en un celular de 3 GB eso significa que el navegador
       mata la pestaña sin decir nada: la persona ve la app desaparecer y no
       sabe si fue su archivo o el visor. Un mensaje es mejor que un cierre. */
    if (file.size > MAX_ARCHIVO) {
      setError(
        `Ese archivo pesa ${formatBytes(file.size)} y es demasiado para abrirlo en un teléfono. ` +
          `El tope son ${formatBytes(MAX_ARCHIVO)}. Ábrelo en una computadora y vuelve a exportarlo con menos habitaciones.`,
      )
      // Sin esto, volver a elegir el MISMO archivo no dispara el onChange y
      // parece que el botón dejó de funcionar.
      if (archivo.current) archivo.current.value = ''
      return
    }
    setImportando(true)
    setError(null)
    try {
      /* El lector de `.tour` se baja AQUÍ y no arriba, y se midió: con el
         `import` estático, `paquete.ts` metía el escritor de ZIP, la escalera de
         migración y la revisión de contraste —7.6 kB— en el chunk de arranque de
         "Mis recorridos", que es el número que este proyecto cuida. Y no hace
         falta ahí: para llegar a esta línea la persona ya eligió un archivo en el
         diálogo del sistema, así que el módulo viaja mientras ella lo busca.
         `mensajeDePaquete` sí se importa arriba, y a propósito: si lo que falla
         es la descarga del módulo, el `catch` tiene que poder dar un mensaje
         igual, y no puede depender de lo que no llegó. */
      const { importarTour } = await import('../../lib/store/paquete')
      const tour = await importarTour(file)
      /* También aquí, no solo al crear: quien importa un recorrido acaba de
         meter todas sus fotos al teléfono y es justo el que más tiene que
         perder si el navegador decide hacer limpieza. Va después del await, así
         que ya no estamos dentro del toque del usuario y Chrome puede decir que
         no; cuando dice que no, lo peor que pasa es que sigue como estaba. */
      void requestPersistence()
      await recargar()
      ir(destinoDe(tour.id, tour.scenes.length))
    } catch (e) {
      setError(mensajeDePaquete(e, 'No se pudo abrir el archivo.'))
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

        {/* Lo que vive en el servidor a nombre de la inmobiliaria, publicado
            desde cualquier teléfono. Solo si este build sabe publicar. */}
        {sePuedePublicar() && (
          <Boton tipo="fantasma" ancho onClick={() => ir({ nombre: 'panel' })}>
            Casas publicadas por link
          </Boton>
        )}

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
                <Tarjeta onClick={() => ir(destinoDe(tour.id, tour.scenes))}>
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
                aria-label={`Editar ${tour.title}`}
                onClick={() => ir({ nombre: 'editar', tourId: tour.id })}
                className="grid w-12 shrink-0 place-items-center rounded-hud border border-white/10
                           bg-white/5 text-ink-200 active:bg-white/15 active:text-ink-50"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 20h4l10-10a2.8 2.8 0 10-4-4L4 16v4z" strokeLinejoin="round" />
                </svg>
              </button>
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
        <Hoja
          titulo="¿Borrar el recorrido?"
          onCerrar={() => {
            setBorrando(null)
            setErrorBorrado(null)
          }}
        >
          <p className="mb-4 text-sm text-ink-200">
            Se va a borrar <b className="text-ink-50">{borrando.title}</b> con todas sus fotos, de
            este teléfono. Si tienes el archivo exportado, ese no se toca.
          </p>
          <div className="flex gap-2">
            <Boton
              ancho
              disabled={borrandoAhora}
              onClick={() => {
                setBorrando(null)
                setErrorBorrado(null)
              }}
            >
              Mejor no
            </Boton>
            {/* La hoja se queda abierta si el borrado falla: es el único sitio
                donde se puede decir qué pasó y volver a intentarlo. */}
            <Boton
              tipo="peligro"
              ancho
              disabled={borrandoAhora}
              onClick={async () => {
                if (!(await quitar(borrando.id))) return
                setBorrando(null)
                await recargar()
              }}
            >
              {borrandoAhora ? 'Borrando…' : 'Sí, borrar'}
            </Boton>
          </div>
          {errorBorrado && (
            <p className="mt-3 text-sm leading-relaxed text-red-300">{errorBorrado}</p>
          )}
        </Hoja>
      )}
    </Pantalla>
  )
}

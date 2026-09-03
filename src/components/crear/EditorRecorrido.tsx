/* oxlint-disable react/set-state-in-effect -- Los efectos sincronizan con
   IndexedDB, que es un sistema externo. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import type { Ruta } from '../../lib/useHashRoute'
import type { StoredScene, StoredTour } from '../../lib/store/types'
import { deleteImage, getTour, saveTour, type OpcionesDeGuardado } from '../../lib/store/tours'
import { entregarArchivo, mensajeDePaquete } from '../../lib/store/entregar'
import { limpiarFicha } from '../../lib/store/migrar'
import { visitasRecientes } from '../../lib/metricas/resumen'
import { nombresDe } from '../../lib/metricas/formato'
import { useBlobUrl } from '../../lib/store/useBlobUrl'
import { contextoSeguro } from '../../lib/capture/camera'
import {
  PublicarError,
  claveGuardada,
  despublicar,
  enlacePublico,
  guardarClave,
  publicarTour,
  resumenDeVisitas,
  sePuedePublicar,
  type ResumenDeVisitas,
} from '../../lib/publicar'
import { Aviso, Boton, Campo, Cargando, Hoja, Interruptor, Pantalla, Tarjeta } from './ui'
import { ResumenVisitas } from './Visitas'

export type EditorRecorridoProps = {
  tourId: string
  ir: (ruta: Ruta) => void
}

function Miniatura({ scene }: { scene: StoredScene }) {
  const url = useBlobUrl(scene.thumbId ?? scene.imageId)

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
  /* El formulario del recorrido trabaja sobre su PROPIO borrador. Editar el
     estado compartido haría que cerrar la hoja sin guardar dejara el cambio a
     medio aplicar: visible en pantalla y persistido con la siguiente acción. */
  const [datos, setDatos] = useState<{ title: string; subtitle: string; autogiro: boolean } | null>(null)
  /**
   * El borrador de la ficha de la casa.
   *
   * Todo se edita como TEXTO, incluidos recámaras y baños, y se convierte al
   * guardar. Con `<input type=number>` un campo a medio escribir es `NaN` y el
   * valor guardado se pierde; con texto, lo que se ve es lo que hay.
   */
  const [ficha, setFicha] = useState<Record<string, string> | null>(null)
  const [confirmarBorrado, setConfirmarBorrado] = useState<StoredScene | null>(null)

  /* ── Reordenar arrastrando ──────────────────────────────────────────────────
   *
   * A mano y sin librería, por tres razones medidas: `dnd-kit` son ~40 kB que
   * caerían justo en el chunk de arranque (esta pantalla la carga App.tsx sin
   * lazy), `react-beautiful-dnd` está sin mantenimiento, y el proyecto ya tiene
   * las primitivas escritas y probadas en Joystick y PuntosEditables: Pointer
   * Events + setPointerCapture + touch-action: none + escribir `transform`
   * directo al DOM, con el umbral de 8 px que distingue toque de arrastre.
   *
   * Todo el estado del gesto vive en refs y el movimiento se escribe al DOM:
   * cero renders de React mientras el dedo se mueve. React solo se entera al
   * soltar, con un único `guardar()`.
   *
   * Y los botones ↑/↓ SE CONSERVAN: son la única ruta con teclado y lector de
   * pantalla. Un arrastre no es accesible por sí solo. */
  const filas = useRef(new Map<string, HTMLDivElement>())
  const arrastre = useRef<{
    id: string
    indice: number
    y0: number
    scrollY0: number
    ultimoY: number
    centros: number[]
    alto: number
    destino: number
    activo: boolean
    scroll: HTMLElement | null
  } | null>(null)
  const autoScroll = useRef(0)
  /* ── Publicar ───────────────────────────────────────────────────────────
     Estados separados del paquete `.tour` porque son dos cosas distintas que
     pueden estar en curso a la vez, y porque publicar puede tardar bastante:
     son varias fotos de 1.5 MB subiendo por datos móviles. De ahí el avance. */
  const [publicando, setPublicando] = useState<
    | null
    | { estado: 'subiendo'; hechas: number; total: number }
    | { estado: 'error'; mensaje: string }
  >(null)
  const [pidiendoClave, setPidiendoClave] = useState(false)
  const [claveEscrita, setClaveEscrita] = useState('')
  const [copiado, setCopiado] = useState(false)
  /* La hoja de visitas: se piden al abrirla, no antes. Es una llamada al Worker
     que suma paquetes; no tiene sentido pagarla en cada render del editor. */
  const [visitas, setVisitas] = useState<
    | null
    | { estado: 'cargando' }
    | { estado: 'listo'; resumen: ResumenDeVisitas; ultimos7: number }
    | { estado: 'error'; mensaje: string }
  >(null)

  const [paquete, setPaquete] = useState<
    | { estado: 'armando' }
    | { estado: 'listo'; blob: Blob; nombre: string; faltantes: string[] }
    | { estado: 'error'; mensaje: string }
    | null
  >(null)
  /* Escribir en IndexedDB puede fallar —disco lleno, modo privado, otra pestaña
     bloqueando la base— y hasta ahora ese fallo era una promesa rechazada que
     nadie atrapaba: la hoja se cerraba igual y el cambio parecía hecho. */
  const [escribiendo, setEscribiendo] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const encontrado = await getTour(tourId)
    setTour(encontrado ?? 'no-existe')
  }, [tourId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Devuelve si la escritura llegó al disco. Quien llama cierra su hoja solo si sí. */
  const guardar = async (siguiente: StoredTour, opciones?: OpcionesDeGuardado): Promise<boolean> => {
    setEscribiendo(true)
    setErrorGuardado(null)
    try {
      const guardado = await saveTour(siguiente, opciones)
      setTour(guardado)
      return true
    } catch (e) {
      setErrorGuardado(
        e instanceof Error ? e.message : 'No se pudo guardar el cambio en este teléfono.',
      )
      return false
    } finally {
      setEscribiendo(false)
    }
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

  /** Saca la habitación de `desde` y la deja en `hasta`. Un solo guardado. */
  const reordenar = (desde: number, hasta: number) => {
    if (desde === hasta || hasta < 0 || hasta >= tour.scenes.length) return
    const scenes = [...tour.scenes]
    const [movida] = scenes.splice(desde, 1)
    scenes.splice(hasta, 0, movida)
    void guardar({ ...tour, scenes })
  }

  const mover = (indice: number, direccion: -1 | 1) => reordenar(indice, indice + direccion)

  /** Deja todas las filas como estaban: sin transform ni realce. */
  const limpiarFilas = () => {
    for (const fila of filas.current.values()) {
      fila.style.transform = ''
      fila.style.transition = ''
      fila.classList.remove('z-10', 'shadow-2xl', 'opacity-90')
    }
  }

  const pararAutoScroll = () => {
    if (autoScroll.current) cancelAnimationFrame(autoScroll.current)
    autoScroll.current = 0
  }

  /**
   * Recoloca las filas según dónde va el dedo. Se llama en cada movimiento y en
   * cada paso del auto-scroll, así que lee el scroll actual y no el del inicio:
   * lo que se ha desplazado la lista también cuenta como movimiento del dedo.
   */
  const acomodar = () => {
    const a = arrastre.current
    if (!a) return
    const fila = filas.current.get(a.id)
    if (!fila) return
    const scrollAhora = a.scroll ? a.scroll.scrollTop : 0
    const dy = a.ultimoY - a.y0 + (scrollAhora - a.scrollY0)
    fila.style.transform = `translate3d(0, ${dy}px, 0)`

    // ¿Sobre qué fila está el centro de la que se arrastra?
    const centro = a.centros[a.indice] + dy
    let destino = a.indice
    let mejor = Infinity
    a.centros.forEach((c, i) => {
      const d = Math.abs(c - centro)
      if (d < mejor) {
        mejor = d
        destino = i
      }
    })
    a.destino = destino

    // Las demás se hacen a un lado para abrir el hueco donde va a caer.
    tour.scenes.forEach((scene, i) => {
      if (scene.id === a.id) return
      const otra = filas.current.get(scene.id)
      if (!otra) return
      let corrimiento = 0
      if (a.indice < destino && i > a.indice && i <= destino) corrimiento = -a.alto
      if (a.indice > destino && i >= destino && i < a.indice) corrimiento = a.alto
      otra.style.transition = 'transform 150ms'
      otra.style.transform = corrimiento ? `translate3d(0, ${corrimiento}px, 0)` : ''
    })
  }

  const empezarArrastre = (event: ReactPointerEvent<HTMLButtonElement>, indice: number, id: string) => {
    const fila = filas.current.get(id)
    if (!fila) return
    event.currentTarget.setPointerCapture(event.pointerId)
    /* Las alturas se MIDEN, no se asumen: las tarjetas cambian de alto según
       si la habitación tiene puntos o foto parcial. */
    const centros = tour.scenes.map((scene) => {
      const r = filas.current.get(scene.id)?.getBoundingClientRect()
      return r ? r.top + r.height / 2 : 0
    })
    let scroll: HTMLElement | null = fila.parentElement
    while (scroll && !/auto|scroll/.test(getComputedStyle(scroll).overflowY)) {
      scroll = scroll.parentElement
    }
    arrastre.current = {
      id,
      indice,
      y0: event.clientY,
      scrollY0: scroll ? scroll.scrollTop : 0,
      ultimoY: event.clientY,
      centros,
      alto: fila.getBoundingClientRect().height + 12, // + el gap-3 de la lista
      destino: indice,
      activo: false,
      scroll,
    }
  }

  const moverArrastre = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const a = arrastre.current
    if (!a) return
    a.ultimoY = event.clientY
    // Umbral de 8 px: un toque sobre el asa no es un arrastre.
    if (!a.activo && Math.abs(a.ultimoY - a.y0) <= 8) return
    if (!a.activo) {
      a.activo = true
      filas.current.get(a.id)?.classList.add('z-10', 'shadow-2xl', 'opacity-90')
    }
    acomodar()

    /* Auto-scroll a 60 px del borde de la lista, con un rAF que se cancela al
       soltar. Sin esto no se puede llevar una habitación más allá de lo que
       cabe en la pantalla. */
    pararAutoScroll()
    const caja = a.scroll?.getBoundingClientRect()
    if (!caja || !a.scroll) return
    const paso = a.ultimoY < caja.top + 60 ? -8 : a.ultimoY > caja.bottom - 60 ? 8 : 0
    if (!paso) return
    const rodar = () => {
      const s = arrastre.current?.scroll
      if (!s) return
      s.scrollTop += paso
      acomodar()
      autoScroll.current = requestAnimationFrame(rodar)
    }
    autoScroll.current = requestAnimationFrame(rodar)
  }

  const soltarArrastre = () => {
    const a = arrastre.current
    pararAutoScroll()
    arrastre.current = null
    limpiarFilas()
    if (a?.activo) reordenar(a.indice, a.destino)
  }

  /* `pointercancel` REVIERTE, no guarda: en iOS una llamada entrante cancela el
     puntero a media operación, y guardar el orden a medias sería peor que no
     haber movido nada. */
  const cancelarArrastre = () => {
    pararAutoScroll()
    arrastre.current = null
    limpiarFilas()
  }

  const borrarEscena = async (scene: StoredScene): Promise<boolean> => {
    const scenes = tour.scenes.filter((s) => s.id !== scene.id)
    // Los puntos que llevaban a esa habitación quedarían sin destino.
    const limpias = scenes.map((s) => ({
      ...s,
      hotspots: s.hotspots.filter((h) => h.kind !== 'link' || h.to !== scene.id),
    }))
    /* El orden es a propósito y no se toca: primero se escribe el recorrido sin
       la habitación y SOLO si eso funcionó se borran sus fotos. Al revés, una
       escritura fallida dejaría el recorrido entero apuntando a fotos que ya no
       existen, y eso no se puede deshacer. */
    const ok = await guardar({
      ...tour,
      scenes: limpias,
      startSceneId: tour.startSceneId === scene.id ? (limpias[0]?.id ?? '') : tour.startSceneId,
    })
    if (!ok) return false
    /* Las fotos ya son huérfanas: el recorrido guardado no las menciona. Si su
       borrado falla, lo único que pasa es que ocupan espacio, así que no vale la
       pena asustar con un error por algo que la persona no puede arreglar. */
    try {
      await deleteImage(scene.imageId)
      if (scene.thumbId) await deleteImage(scene.thumbId)
    } catch {
      /* espacio desperdiciado, nada más */
    }
    setEditando(null)
    return true
  }

  const prepararArchivo = async () => {
    setPaquete({ estado: 'armando' })
    try {
      /* El escritor de `.tour` se baja AQUÍ y no arriba, y se midió: con el
         `import` estático metía 7.6 kB en el chunk de arranque (el ZIP, la
         escalera de migración, la revisión de contraste), y esta pantalla la
         carga `App.tsx` sin `lazy()`. El botón ya dice "Armando el archivo…", así
         que el módulo viaja dentro de una espera que ya existía.

         OJO con lo que NO se movió: `entregarArchivo` se importa arriba, estática,
         porque en iOS compartir solo se permite mientras dure la activación del
         toque y un `await import()` la gasta. Ver el encabezado de entregar.ts. */
      const { exportarTour } = await import('../../lib/store/paquete')
      const { blob, nombre, faltantes } = await exportarTour(tour.id)
      setPaquete({ estado: 'listo', blob, nombre, faltantes })
    } catch (e) {
      setPaquete({ estado: 'error', mensaje: mensajeDePaquete(e, 'No se pudo armar el archivo.') })
    }
  }

  /* ── Publicar la casa ────────────────────────────────────────────────────
     Lo que convierte un recorrido en algo que se le puede enseñar a alguien:
     hasta aquí vivía en este teléfono y solo se podía pasar como archivo.

     La clave no está en el código de la app —es un sitio estático, cualquiera
     leería su JavaScript— así que la escribe la persona una vez y se queda en
     este navegador. Si no hay ninguna guardada, se pide antes de subir nada. */
  const subir = async (clave: string) => {
    setPublicando({ estado: 'subiendo', hechas: 0, total: 1 })
    try {
      /* Si ya hay una llave se publica SOBRE ella: el link que el agente ya
         mandó sigue sirviendo y enseña la casa nueva. Antes cada "volver a
         subir" creaba una llave nueva y dejaba la vieja viva en el servidor. */
      const { llave, editToken, publicadoEn } = await publicarTour(
        tour,
        clave,
        (avance) => setPublicando({ estado: 'subiendo', ...avance }),
        tour.publicacion,
      )
      /* Se guarda la llave ANTES de dar por buena la publicación: si esta
         escritura fallara y no se guardara, la casa quedaría en línea y sin
         forma de bajarla desde aquí.

         Y se guarda SIN mover `updatedAt`: publicar no es editar la casa. Es lo
         que hace que "hay cambios sin publicar" compare fechas de verdad —el
         contenido contra la subida— y no salte justo después de publicar. */
      await guardar(
        {
          ...tour,
          publicacion: { llave, editToken: editToken ?? tour.publicacion?.editToken, publicadoEn },
        },
        { conservarFecha: true },
      )
      setPublicando(null)
      setCopiado(false)
    } catch (e) {
      setPublicando({
        estado: 'error',
        mensaje:
          e instanceof PublicarError
            ? [e.message, e.consejo].filter(Boolean).join(' ')
            : 'No se pudo publicar el recorrido.',
      })
    }
  }

  const publicar = () => {
    const clave = claveGuardada()
    if (!clave) {
      setClaveEscrita('')
      setPidiendoClave(true)
      return
    }
    void subir(clave)
  }

  const bajar = async () => {
    if (!tour.publicacion) return
    setPublicando({ estado: 'subiendo', hechas: 0, total: 1 })
    try {
      await despublicar(tour.publicacion.llave, claveGuardada(), tour.publicacion.editToken)
      await guardar({ ...tour, publicacion: undefined }, { conservarFecha: true })
      setPublicando(null)
    } catch (e) {
      setPublicando({
        estado: 'error',
        mensaje: e instanceof PublicarError ? e.message : 'No se pudo dar de baja el recorrido.',
      })
    }
  }

  const copiarEnlace = async () => {
    if (!tour.publicacion) return
    try {
      await navigator.clipboard.writeText(enlacePublico(tour.publicacion.llave))
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      /* Safari solo deja escribir en el portapapeles desde un gesto y con
         permiso; si dice que no, el link sigue a la vista para copiarlo a
         mano, que es justo para lo que se enseña completo. */
      setPublicando({
        estado: 'error',
        mensaje: 'No se pudo copiar solo. Mantén el dedo sobre el link para copiarlo.',
      })
    }
  }

  const verVisitas = async () => {
    if (!tour.publicacion) return
    setVisitas({ estado: 'cargando' })
    try {
      const resumen = await resumenDeVisitas(
        tour.publicacion.llave,
        claveGuardada(),
        tour.publicacion.editToken,
      )
      setVisitas({ estado: 'listo', resumen, ultimos7: visitasRecientes(resumen.porDia, Date.now()) })
    } catch (e) {
      setVisitas({
        estado: 'error',
        mensaje:
          e instanceof PublicarError
            ? [e.message, e.consejo].filter(Boolean).join(' ')
            : 'No se pudieron leer las visitas.',
      })
    }
  }

  const listo = tour.scenes.length > 0

  /* ── "Hay cambios sin publicar" ─────────────────────────────────────────────
     Publicar → editar en local → el link sigue enseñando lo viejo, EN SILENCIO.
     Es la queja de soporte número uno si falta. `updatedAt` solo se mueve al
     editar la casa (anotar la publicación lo conserva), así que comparar las
     dos fechas dice la verdad. */
  const publicacion = tour.publicacion
  /* `>=` y no `>`: cuando se publica bien, `updatedAt` es la fecha de la última
     edición del contenido, siempre ANTERIOR a que la subida termine (subir tarda
     segundos). Con `>`, un guardado que moviera la fecha en el mismo milisegundo
     que `publicadoEn` pasaría por "al día": el sabotaje de quitar
     `conservarFecha` solo se veía a veces. Con `>=` se ve siempre. */
  const hayCambios = publicacion !== undefined && tour.updatedAt >= publicacion.publicadoEn
  const fechaPublicada = publicacion
    ? new Date(publicacion.publicadoEn).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
    : ''

  /* El mismo mensaje se enseña en dos sitios porque el fallo puede venir de dos
     lados: de una hoja abierta (renombrar, ajustes, borrar) o de las flechas de
     reordenar, que están en la lista. Cuando hay una hoja encima, la lista está
     tapada, así que ahí no sirve de nada ponerlo. */
  const hojaAbierta =
    agregando || datos !== null || confirmarBorrado !== null || editando !== null || pidiendoClave || visitas !== null
  const avisoError = errorGuardado ? (
    <p className="text-sm leading-relaxed text-red-300">{errorGuardado}</p>
  ) : null

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
        {!hojaAbierta && errorGuardado && (
          <Aviso tono="error" titulo="No se guardó">
            {errorGuardado}
          </Aviso>
        )}

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
          <div
            key={scene.id}
            ref={(nodo) => {
              if (nodo) filas.current.set(scene.id, nodo)
              else filas.current.delete(scene.id)
            }}
            data-fila={scene.id}
            className="relative"
          >
          <Tarjeta>
            <div className="flex items-center gap-3">
              {/* El asa: 44×44 y `touch-none` SOLO aquí, no en la tarjeta ni en
                  la lista, porque esta pantalla sí hace scroll vertical y con
                  `touch-action: none` en toda la fila la lista dejaría de poder
                  desplazarse con tres habitaciones. */}
              <button
                type="button"
                aria-label={`Arrastrar ${scene.name}`}
                onPointerDown={(event) => empezarArrastre(event, indice, scene.id)}
                onPointerMove={moverArrastre}
                onPointerUp={soltarArrastre}
                onPointerCancel={cancelarArrastre}
                className="grid h-11 w-11 shrink-0 cursor-grab touch-none select-none place-items-center
                           rounded-lg bg-white/10 text-ink-200 active:cursor-grabbing active:bg-white/20"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                  <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
                  <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
                  <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
                </svg>
              </button>
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
              {/* 44×44 cada una, el mínimo cómodo para un pulgar: reordenar mal
                  por un mal toque es de las cosas que más molestan, y estaban
                  en 32×28. */}
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  aria-label={`Subir ${scene.name}`}
                  onClick={() => mover(indice, -1)}
                  disabled={indice === 0 || escribiendo}
                  className="grid h-11 w-11 place-items-center rounded-lg bg-white/10 text-sm
                             active:bg-white/20 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Bajar ${scene.name}`}
                  onClick={() => mover(indice, 1)}
                  disabled={indice === tour.scenes.length - 1 || escribiendo}
                  className="grid h-11 w-11 place-items-center rounded-lg bg-white/10 text-sm
                             active:bg-white/20 disabled:opacity-30"
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
          </div>
        ))}

        {listo && sePuedePublicar() && (
          <>
            <div className="mt-2 h-px bg-white/10" />
            <Tarjeta>
              <p className="mb-1 font-semibold">Enseñar por link</p>
              <p className="mb-3 text-sm text-ink-200">
                Sube la casa para poder mandarla por WhatsApp. Quien reciba el link la abre sin
                instalar nada y sin cuenta. El link no aparece en Google: solo entra quien lo tenga.
              </p>

              {publicacion ? (
                <div className="flex flex-col gap-2">
                  <p
                    className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm
                               break-all text-ink-50 select-all"
                  >
                    {enlacePublico(publicacion.llave)}
                  </p>
                  {hayCambios ? (
                    <Aviso tono="alerta" titulo="Hay cambios sin publicar">
                      El link enseña la versión que subiste el {fechaPublicada}. Vuelve a subir
                      para que quien lo abra vea los cambios.
                    </Aviso>
                  ) : (
                    <p className="text-xs text-ink-200/70">
                      El link está al día: enseña lo que subiste el {fechaPublicada}.
                    </p>
                  )}
                  <Boton
                    tipo={hayCambios ? 'principal' : 'normal'}
                    ancho
                    onClick={() => void subir(claveGuardada())}
                    disabled={publicando?.estado === 'subiendo'}
                  >
                    Volver a subir con los cambios
                  </Boton>
                  <Boton tipo={hayCambios ? 'normal' : 'principal'} ancho onClick={() => void copiarEnlace()}>
                    {copiado ? 'Copiado' : 'Copiar el link'}
                  </Boton>
                  <Boton ancho onClick={() => void verVisitas()}>
                    Ver visitas
                  </Boton>
                  <Boton
                    tipo="fantasma"
                    ancho
                    onClick={() => void bajar()}
                    disabled={publicando?.estado === 'subiendo'}
                  >
                    Quitar de internet
                  </Boton>
                  {/* El código de rescate vive SOLO en este teléfono. Si se
                      pierde el aparato, con él se puede volver a subir o dar de
                      baja este link desde otro; sin él, solo dar de baja con el
                      código de la inmobiliaria. Se enseña plegado: es un dato
                      para guardar aparte, no para leer cada vez. */}
                  {publicacion.editToken && (
                    <details className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2 text-sm">
                      <summary className="cursor-pointer py-1 text-ink-200">Código de rescate</summary>
                      <p className="mt-2 text-xs text-ink-200/70">
                        Si cambias de teléfono, con este código puedes volver a subir o dar de baja
                        este link desde otro. Guárdalo aparte.
                      </p>
                      <p className="mt-2 font-mono text-sm break-all text-ink-50 select-all">
                        {publicacion.editToken}
                      </p>
                    </details>
                  )}
                </div>
              ) : (
                <Boton
                  tipo="principal"
                  ancho
                  onClick={publicar}
                  disabled={publicando?.estado === 'subiendo'}
                >
                  Publicar y obtener el link
                </Boton>
              )}

              {publicando?.estado === 'subiendo' && (
                <p className="mt-2 text-sm text-ink-200" role="status" aria-live="polite">
                  Subiendo {publicando.hechas} de {publicando.total} archivos…
                </p>
              )}
              {publicando?.estado === 'error' && (
                <p className="mt-2 text-sm text-red-300">{publicando.mensaje}</p>
              )}
            </Tarjeta>
          </>
        )}

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
              {/* El archivo se arma aunque a una habitación le falte su foto —el
                  respaldo importa justo cuando el navegador ya borró cosas— pero
                  hay que DECIR qué se quedó fuera, o el agente cree que tiene una
                  copia completa y la tiene incompleta. */}
              {paquete?.estado === 'listo' && paquete.faltantes.length > 0 && (
                <p className="mt-2 text-sm text-amber-300">
                  {paquete.faltantes.length === 1
                    ? `No se pudo incluir "${paquete.faltantes[0]}": su foto ya no está en el teléfono.`
                    : `No se pudieron incluir ${paquete.faltantes.length} habitaciones (${paquete.faltantes.join(', ')}): sus fotos ya no están en el teléfono.`}
                </p>
              )}
            </Tarjeta>
          </>
        )}

        {/* La ficha es lo que ve un comprador ANTES de entrar al recorrido, así
            que va junto a lo de compartir y no escondida en los ajustes de una
            habitación: es una decisión de venta, no de configuración. */}
        <Tarjeta>
          <p className="mb-1 font-semibold">Datos de la casa</p>
          <p className="mb-3 text-sm text-ink-200">
            Precio, metros y contacto. Es la portada que ve quien recibe el link, antes de entrar
            al recorrido. Si la dejas vacía, el link abre directo al recorrido.
          </p>
          <Boton
            ancho
            onClick={() =>
              setFicha({
                precio: tour.ficha?.precio ?? '',
                superficie: tour.ficha?.superficie ?? '',
                recamaras: tour.ficha?.recamaras !== undefined ? String(tour.ficha.recamaras) : '',
                banos: tour.ficha?.banos !== undefined ? String(tour.ficha.banos) : '',
                direccion: tour.ficha?.direccion ?? '',
                descripcion: tour.ficha?.descripcion ?? '',
                agenteNombre: tour.ficha?.agente?.nombre ?? '',
                agenteWhatsapp: tour.ficha?.agente?.whatsapp ?? '',
                agenteTelefono: tour.ficha?.agente?.telefono ?? '',
                agenteCorreo: tour.ficha?.agente?.correo ?? '',
              })
            }
          >
            {tour.ficha ? 'Cambiar los datos' : 'Agregar los datos'}
          </Boton>
        </Tarjeta>

        {/* El plano de la casa: la planta con un alfiler por habitación. Es lo
            que le dice al comprador dónde está parado y hacia dónde mira, y va
            aquí y no dentro de una habitación porque es UN plano para toda la
            casa. Solo con habitaciones: sin ellas no hay nada que colocar. */}
        {listo && (
          <Tarjeta>
            <p className="mb-1 font-semibold">Plano de la casa</p>
            <p className="mb-3 text-sm text-ink-200">
              {tour.plano
                ? `${tour.scenes.filter((s) => s.plano).length} de ${tour.scenes.length} ${
                    tour.scenes.length === 1 ? 'habitación colocada' : 'habitaciones colocadas'
                  }. Quien vea el recorrido tendrá un plano con dónde está parado.`
                : 'Sube la planta arquitectónica y marca dónde está cada habitación: quien vea el recorrido sabrá en qué parte de la casa está parado.'}
            </p>
            <Boton ancho onClick={() => ir({ nombre: 'plano', tourId: tour.id })}>
              {tour.plano ? 'Editar el plano' : 'Agregar el plano'}
            </Boton>
          </Tarjeta>
        )}

        <Boton
          tipo="fantasma"
          ancho
          onClick={() =>
            setDatos({ title: tour.title, subtitle: tour.subtitle ?? '', autogiro: tour.autogiro === true })
          }
        >
          Cambiar el nombre del recorrido
        </Boton>
      </div>

      {visitas && (
        <Hoja titulo="Visitas" onCerrar={() => setVisitas(null)}>
          {visitas.estado === 'cargando' && <Cargando texto="Sumando las visitas…" />}
          {visitas.estado === 'error' && (
            <Aviso tono="error" titulo="No se pudieron leer">
              {visitas.mensaje}
            </Aviso>
          )}
          {visitas.estado === 'listo' && (
            <ResumenVisitas resumen={visitas.resumen} ultimos7={visitas.ultimos7} nombres={nombresDe(tour)} />
          )}
        </Hoja>
      )}

      {pidiendoClave && (
        <Hoja titulo="Código para publicar" onCerrar={() => setPidiendoClave(false)}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-200">
              Es el código de invitación de tu inmobiliaria (o la clave del servidor, si tú lo
              operas). Se escribe una sola vez: queda guardado en este teléfono. No viene dentro
              de la app porque cualquiera podría leerlo.
            </p>
            <Campo
              etiqueta="Código"
              valor={claveEscrita}
              onChange={setClaveEscrita}
              placeholder="El código que te dio tu inmobiliaria"
            />
            <Boton
              tipo="principal"
              ancho
              disabled={!claveEscrita.trim()}
              onClick={() => {
                const clave = claveEscrita.trim()
                guardarClave(clave)
                setPidiendoClave(false)
                void subir(clave)
              }}
            >
              Guardar y publicar
            </Boton>
          </div>
        </Hoja>
      )}

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
        <Hoja titulo="Datos del recorrido" onCerrar={() => setDatos(null)}>
          <div className="flex flex-col gap-3">
            <Campo
              etiqueta="Nombre"
              valor={datos.title}
              onChange={(title) => setDatos({ ...datos, title })}
              maxLength={60}
            />
            <Campo
              etiqueta="Renglón de abajo (opcional)"
              valor={datos.subtitle}
              onChange={(subtitle) => setDatos({ ...datos, subtitle })}
              placeholder="3 recámaras · 120 m²"
              maxLength={80}
            />
            <Interruptor
              etiqueta="Gira solo al abrirlo (modo kiosco)"
              ayuda="Para una pantalla en la oficina o en una feria: da una vuelta por minuto hasta que alguien lo toca, y sigue a los cinco segundos. No gira si el teléfono pide menos movimiento."
              valor={datos.autogiro}
              onChange={(autogiro) => setDatos({ ...datos, autogiro })}
            />
            <Boton
              tipo="principal"
              ancho
              disabled={!datos.title.trim() || escribiendo}
              onClick={async () => {
                const ok = await guardar({
                  ...tour,
                  title: datos.title.trim(),
                  subtitle: datos.subtitle.trim() || undefined,
                  autogiro: datos.autogiro || undefined,
                })
                if (ok) setDatos(null)
              }}
            >
              {escribiendo ? 'Guardando…' : 'Guardar'}
            </Boton>
            {avisoError}
          </div>
        </Hoja>
      )}

      {ficha && (
        <Hoja titulo="Datos de la casa" onCerrar={() => setFicha(null)}>
          <div className="flex flex-col gap-3">
            <Campo
              etiqueta="Precio"
              valor={ficha.precio}
              onChange={(precio) => setFicha({ ...ficha, precio })}
              placeholder="$1,950,000  ·  o  Precio a consultar"
              maxLength={40}
              ayuda="Se muestra tal cual: puedes escribir «Desde $1.9M» o «A consultar»."
            />
            <Campo
              etiqueta="Superficie"
              valor={ficha.superficie}
              onChange={(superficie) => setFicha({ ...ficha, superficie })}
              placeholder="120 m² de construcción"
              maxLength={40}
            />
            <div className="flex gap-3">
              <Campo
                etiqueta="Recámaras"
                valor={ficha.recamaras}
                onChange={(recamaras) => setFicha({ ...ficha, recamaras })}
                placeholder="3"
                maxLength={2}
              />
              <Campo
                etiqueta="Baños"
                valor={ficha.banos}
                onChange={(banos) => setFicha({ ...ficha, banos })}
                placeholder="2"
                maxLength={2}
              />
            </div>
            <Campo
              etiqueta="Dirección"
              valor={ficha.direccion}
              onChange={(direccion) => setFicha({ ...ficha, direccion })}
              placeholder="Fracc. Los Robles, Tlajomulco"
              maxLength={160}
            />
            <Campo
              etiqueta="Descripción (opcional)"
              valor={ficha.descripcion}
              onChange={(descripcion) => setFicha({ ...ficha, descripcion })}
              placeholder="Dos plantas, patio y cochera para dos autos."
              maxLength={600}
            />

            <div className="mt-1 h-px bg-white/10" />
            <p className="text-sm font-semibold">Quién atiende</p>
            <Campo
              etiqueta="Nombre"
              valor={ficha.agenteNombre}
              onChange={(agenteNombre) => setFicha({ ...ficha, agenteNombre })}
              maxLength={80}
            />
            <Campo
              etiqueta="WhatsApp"
              valor={ficha.agenteWhatsapp}
              onChange={(agenteWhatsapp) => setFicha({ ...ficha, agenteWhatsapp })}
              placeholder="52 33 1234 5678"
              maxLength={20}
              ayuda="Con lada de país. Se limpia solo: el botón abre wa.me."
            />
            <Campo
              etiqueta="Teléfono para llamar"
              valor={ficha.agenteTelefono}
              onChange={(agenteTelefono) => setFicha({ ...ficha, agenteTelefono })}
              placeholder="33 1234 5678"
              maxLength={30}
            />
            {/* Faltaba, y no era solo una omisión: la hoja reconstruía el objeto
                `agente` desde cero con los tres campos que sí tenía, así que
                abrir "Cambiar los datos" y tocar Guardar sin escribir nada BORRABA
                el correo que viniera de un `.tour` importado. Comprobado. */}
            <Campo
              etiqueta="Correo"
              valor={ficha.agenteCorreo}
              onChange={(agenteCorreo) => setFicha({ ...ficha, agenteCorreo })}
              placeholder="elias@inmobiliaria.mx"
              maxLength={120}
            />

            <Boton
              tipo="principal"
              ancho
              onClick={async () => {
                /* Se arma y se limpia con la MISMA función que filtra lo que
                   viene de un archivo `.tour`. Así el editor no puede guardar
                   nada que el importador rechazaría, y la validación vive en un
                   solo lugar. */
                const armada = limpiarFicha({
                  precio: ficha.precio,
                  superficie: ficha.superficie,
                  recamaras: ficha.recamaras ? Number(ficha.recamaras) : undefined,
                  banos: ficha.banos ? Number(ficha.banos) : undefined,
                  direccion: ficha.direccion,
                  descripcion: ficha.descripcion,
                  agente: {
                    nombre: ficha.agenteNombre,
                    whatsapp: ficha.agenteWhatsapp,
                    telefono: ficha.agenteTelefono,
                    correo: ficha.agenteCorreo,
                  },
                })
                await guardar({ ...tour, ficha: armada })
                setFicha(null)
              }}
            >
              Guardar
            </Boton>
            {tour.ficha && (
              <Boton
                tipo="peligro"
                ancho
                onClick={async () => {
                  await guardar({ ...tour, ficha: undefined })
                  setFicha(null)
                }}
              >
                Quitar la portada
              </Boton>
            )}
          </div>
        </Hoja>
      )}

      {confirmarBorrado && (
        <Hoja titulo="¿Borrar la habitación?" onCerrar={() => setConfirmarBorrado(null)}>
          <p className="mb-4 text-sm text-ink-200">
            Se va a borrar <b className="text-ink-50">{confirmarBorrado.name}</b> con su foto y sus
            puntos. Los puntos de otras habitaciones que llevaban aquí también se quitan. No hay
            manera de deshacerlo.
          </p>
          <div className="flex gap-2">
            <Boton ancho onClick={() => setConfirmarBorrado(null)} disabled={escribiendo}>
              Mejor no
            </Boton>
            {/* La hoja se queda abierta hasta que el borrado esté escrito. Antes
                se cerraba primero y se borraba después, así que un fallo dejaba
                la habitación en la lista sin que nada lo explicara. */}
            <Boton
              tipo="peligro"
              ancho
              disabled={escribiendo}
              onClick={async () => {
                if (await borrarEscena(confirmarBorrado)) setConfirmarBorrado(null)
              }}
            >
              {escribiendo ? 'Borrando…' : 'Sí, borrar'}
            </Boton>
          </div>
          {avisoError && <div className="mt-3">{avisoError}</div>}
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
              disabled={escribiendo}
              onClick={async () => {
                const ok = await guardar({
                  ...tour,
                  scenes: tour.scenes.map((s) => (s.id === editando.id ? editando : s)),
                })
                if (ok) setEditando(null)
              }}
            >
              {escribiendo ? 'Guardando…' : 'Guardar'}
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
                disabled={escribiendo}
                onClick={async () => {
                  if (await guardar({ ...tour, startSceneId: editando.id })) setEditando(null)
                }}
              >
                Que el recorrido empiece aquí
              </Boton>
            )}
            <Boton
              tipo="peligro"
              ancho
              onClick={() => {
                const escena = tour.scenes.find((s) => s.id === editando.id)
                setEditando(null)
                if (escena) setConfirmarBorrado(escena)
              }}
            >
              Borrar la habitación
            </Boton>
            {avisoError}
          </div>
        </Hoja>
      )}
    </Pantalla>
  )
}

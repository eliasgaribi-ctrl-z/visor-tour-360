/* oxlint-disable react/set-state-in-effect -- Los efectos sincronizan con
   IndexedDB y con la decodificación de imágenes, que son sistemas externos. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import type { Ruta } from '../../lib/useHashRoute'
import type { StoredScene, StoredTour } from '../../lib/store/types'
import type { PosicionEnPlano } from '../../lib/types'
import { deleteImage, getTour, putImage, saveTour } from '../../lib/store/tours'
import { useBlobUrl } from '../../lib/store/useBlobUrl'
import { ImportError, aJpeg, leerImagen } from '../../lib/capture/importar'
import { reducir, soltarLienzo } from '../../lib/capture/frames'
import { caminoDelCono, giroHeredado, posicionEnPlano, referenciaDeGiro } from '../../lib/planta'
import { Aviso, Boton, Cargando, Hoja, Pantalla, Tarjeta } from './ui'

export type EditorPlanoProps = {
  tourId: string
  ir: (ruta: Ruta) => void
}

/** A cuánto se reduce el plano al guardarlo: de sobra para un teléfono, y ~300 kB. */
const ANCHO_PLANO = 1600
/** Un toque no es un arrastre. Menor que el de los puntos (8): el alfiler es chico. */
const UMBRAL_ARRASTRE = 6
/** Apertura con la que se dibuja el cono en el editor, donde no hay cámara. */
const FOV_EDITOR = 75

type Colocada = StoredScene & { plano: PosicionEnPlano }

/**
 * ============================================================================
 *  EL PLANO DE LA CASA: DÓNDE ESTÁ CADA HABITACIÓN
 * ============================================================================
 *
 * Se sube la planta arquitectónica (una foto o una imagen) y se marca dónde está
 * cada habitación arrastrando un alfiler. Con eso el visor enseña el minimapa:
 * dónde está parado el comprador y, si se indicó, hacia dónde mira.
 *
 * Arrastrar es el mismo gesto que los puntos del editor y las filas del
 * recorrido: Pointer Events + `setPointerCapture` + `touch-action: none` SOLO en
 * el alfiler, umbral para distinguir un toque de un arrastre, y la posición se
 * escribe al DOM mientras el dedo se mueve. React se entera al soltar, con un
 * solo guardado. En 2-D no hay proyección que deshacer: la posición es la
 * fracción del ancho y del alto de la imagen (`posicionEnPlano`).
 *
 * ── Hacia dónde mira cada foto, y el regalo del rumbo ──────────────────────
 *
 * El cono del minimapa necesita saber a qué ángulo del plano mira el frente de
 * la foto (`giro`). Se indica con un control por habitación… una vez. Las
 * habitaciones capturadas con el teléfono traen `rumbo`, y dos rumbos se
 * orientan entre sí: al orientar la primera, las demás capturadas que aún no
 * tienen cono se orientan solas (`giroHeredado`). Una foto importada no tiene
 * rumbo y se orienta a mano, o se queda sin cono: la orientación no se inventa.
 *
 * ── Lo que NO hace ─────────────────────────────────────────────────────────
 *
 * No recorta ni endereza el plano: es una imagen tal cual, reducida a 1600 px.
 * Y no hay un almacén nuevo en IndexedDB: el plano es un blob más, junto a las
 * fotos y el logo, con su llave en `StoredTour.plano`.
 */
export function EditorPlano({ tourId, ir }: EditorPlanoProps) {
  const [tour, setTour] = useState<StoredTour | null | 'no-existe'>(null)
  const [seleccion, setSeleccion] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmarQuitar, setConfirmarQuitar] = useState(false)

  const entrada = useRef<HTMLInputElement>(null)
  const caja = useRef<HTMLDivElement>(null)
  const nodos = useRef(new Map<string, HTMLElement>())
  const arrastre = useRef<{
    id: string
    x0: number
    y0: number
    activo: boolean
    pos: { x: number; y: number } | null
  } | null>(null)
  /* El control de giro escribe en cada píxel; IndexedDB, al soltar. Lo que quede
     pendiente al salir de la pantalla se escribe igual. */
  const temporizador = useRef(0)
  const porGuardar = useRef<StoredTour | null>(null)

  useEffect(() => {
    void getTour(tourId).then((t) => setTour(t ?? 'no-existe'))
  }, [tourId])

  useEffect(
    () => () => {
      window.clearTimeout(temporizador.current)
      if (porGuardar.current) void saveTour(porGuardar.current).catch(() => undefined)
    },
    [],
  )

  const url = useBlobUrl(tour && tour !== 'no-existe' ? tour.plano?.imageId : undefined)

  /**
   * Pinta primero y escribe después, como el editor de puntos: arrastrar un
   * alfiler y esperar a IndexedDB para verlo moverse se siente roto. Si la
   * escritura falla, la pantalla vuelve a como estaba y lo dice.
   */
  const escribir = useCallback(async (siguiente: StoredTour, previo: StoredTour): Promise<boolean> => {
    setTour(siguiente)
    setError(null)
    try {
      await saveTour(siguiente)
      return true
    } catch (e) {
      setTour(previo)
      setError(e instanceof Error ? e.message : 'No se pudo guardar el cambio en este teléfono.')
      return false
    }
  }, [])

  const volver = () => ir({ nombre: 'editar', tourId })

  if (tour === null) {
    return (
      <Pantalla titulo="Plano de la casa" atras={volver}>
        <Cargando />
      </Pantalla>
    )
  }

  if (tour === 'no-existe') {
    return (
      <Pantalla titulo="Plano de la casa" atras={volver}>
        <Aviso tono="error" titulo="Ya no está">
          Este recorrido no está guardado en este teléfono.
        </Aviso>
      </Pantalla>
    )
  }

  const cambiarEscena = (id: string, cambio: (s: StoredScene) => StoredScene) =>
    escribir({ ...tour, scenes: tour.scenes.map((s) => (s.id === id ? cambio(s) : s)) }, tour)

  const elegirPlano = async (file: File) => {
    setTrabajando(true)
    setError(null)
    let nuevoId: string | null = null
    try {
      /* `leerImagen` ya respeta la orientación EXIF y el tope de píxeles de un
         canvas en iOS; `reducir` deja el plano en 1600 px de ancho como mucho. */
      const lienzo = await leerImagen(file)
      const chico = reducir(lienzo, ANCHO_PLANO) as HTMLCanvasElement
      const ancho = chico.width
      const alto = chico.height
      const blob = await aJpeg(chico, 0.85)
      if (chico !== lienzo) soltarLienzo(chico)
      soltarLienzo(lienzo)

      nuevoId = await putImage(blob)
      const anterior = tour.plano?.imageId
      const ok = await escribir({ ...tour, plano: { imageId: nuevoId, ancho, alto } }, tour)
      /* Se borra el blob que quedó huérfano: el viejo si el cambio entró, el
         nuevo si no. Si el borrado falla solo sobra espacio, y no se avisa. */
      const huerfano = ok ? anterior : nuevoId
      if (huerfano && huerfano !== (ok ? nuevoId : anterior)) {
        try {
          await deleteImage(huerfano)
        } catch {
          /* espacio desperdiciado, nada más */
        }
      }
    } catch (e) {
      setError(
        e instanceof ImportError
          ? [e.message, e.consejo].filter(Boolean).join(' ')
          : 'No se pudo abrir la imagen del plano.',
      )
    } finally {
      setTrabajando(false)
      if (entrada.current) entrada.current.value = ''
    }
  }

  /** Quita el plano Y las posiciones: sin plano no significan nada, y uno nuevo empieza limpio. */
  const quitarPlano = async () => {
    const anterior = tour.plano?.imageId
    const scenes = tour.scenes.map((s) => {
      const copia = { ...s }
      delete copia.plano
      return copia
    })
    const ok = await escribir({ ...tour, plano: undefined, scenes }, tour)
    setSeleccion(null)
    setConfirmarQuitar(false)
    if (ok && anterior) {
      try {
        await deleteImage(anterior)
      } catch {
        /* espacio desperdiciado, nada más */
      }
    }
  }

  /** La habitación aparece en el centro del plano, para arrastrarla desde ahí. */
  const colocar = (id: string) => {
    const escena = tour.scenes.find((s) => s.id === id)
    if (!escena) return
    const posicion: PosicionEnPlano = { x: 0.5, y: 0.5 }
    /* Si tiene rumbo y otra habitación con rumbo ya sabe hacia dónde mira en el
       plano, esta nace orientada: es el regalo de haber guardado el rumbo. */
    const referencia = referenciaDeGiro(tour.scenes, id)
    if (escena.rumbo !== undefined && referencia) posicion.giro = giroHeredado(escena.rumbo, referencia)
    void cambiarEscena(id, (s) => ({ ...s, plano: posicion }))
    setSeleccion(id)
  }

  const sacar = (id: string) => {
    void cambiarEscena(id, (s) => {
      const copia = { ...s }
      delete copia.plano
      return copia
    })
    setSeleccion(null)
  }

  const sinCono = (id: string) => {
    void cambiarEscena(id, (s) => ({ ...s, plano: { x: s.plano?.x ?? 0.5, y: s.plano?.y ?? 0.5 } }))
  }

  /**
   * Orienta la habitación y, si tiene rumbo, a las demás capturadas que todavía
   * no saben hacia dónde miran. Las que ya tienen cono no se tocan: puede que
   * alguien las haya ajustado a mano.
   */
  const girar = (id: string, giro: number) => {
    const escena = tour.scenes.find((s) => s.id === id)
    if (!escena?.plano) return
    const siguiente: StoredTour = {
      ...tour,
      scenes: tour.scenes.map((s) => {
        const p = s.plano
        if (!p) return s
        if (s.id === id) return { ...s, plano: { x: p.x, y: p.y, giro } }
        if (escena.rumbo !== undefined && s.rumbo !== undefined && p.giro === undefined) {
          return { ...s, plano: { x: p.x, y: p.y, giro: giroHeredado(s.rumbo, { rumbo: escena.rumbo, giro }) } }
        }
        return s
      }),
    }
    setTour(siguiente)
    porGuardar.current = siguiente
    window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => {
      porGuardar.current = null
      void saveTour(siguiente).catch((e) =>
        setError(e instanceof Error ? e.message : 'No se pudo guardar el cambio en este teléfono.'),
      )
    }, 350)
  }

  /* ── Arrastrar un alfiler ──────────────────────────────────────────────── */

  const alBajar = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    arrastre.current = { id, x0: event.clientX, y0: event.clientY, activo: false, pos: null }
  }

  const alMover = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const a = arrastre.current
    if (!a || !caja.current) return
    if (!a.activo && Math.hypot(event.clientX - a.x0, event.clientY - a.y0) <= UMBRAL_ARRASTRE) return
    a.activo = true
    a.pos = posicionEnPlano(event.clientX, event.clientY, caja.current.getBoundingClientRect())
    const nodo = nodos.current.get(a.id)
    if (nodo) {
      nodo.style.left = `${a.pos.x * 100}%`
      nodo.style.top = `${a.pos.y * 100}%`
    }
  }

  const alSoltar = () => {
    const a = arrastre.current
    arrastre.current = null
    if (!a) return
    if (a.activo && a.pos) {
      const pos = a.pos
      void cambiarEscena(a.id, (s) => {
        const nueva: PosicionEnPlano = { x: pos.x, y: pos.y }
        if (s.plano?.giro !== undefined) nueva.giro = s.plano.giro
        return { ...s, plano: nueva }
      })
    }
    // Un toque —sin arrastre— elige el alfiler; un arrastre también lo deja elegido.
    setSeleccion(a.id)
  }

  /* `pointercancel` revierte: el alfiler vuelve a donde estaba guardado. */
  const alCancelar = () => {
    const a = arrastre.current
    arrastre.current = null
    if (!a) return
    const escena = tour.scenes.find((s) => s.id === a.id)
    const nodo = nodos.current.get(a.id)
    if (escena?.plano && nodo) {
      nodo.style.left = `${escena.plano.x * 100}%`
      nodo.style.top = `${escena.plano.y * 100}%`
    }
  }

  const colocadas = tour.scenes.filter((s): s is Colocada => s.plano !== undefined)
  const sinColocar = tour.scenes.filter((s) => !s.plano)
  const elegida = seleccion ? colocadas.find((s) => s.id === seleccion) : undefined

  return (
    <Pantalla titulo="Plano de la casa" subtitulo={tour.title} atras={volver}>
      <div className="mx-auto flex w-full max-w-md flex-col gap-3">
        {error && (
          <Aviso tono="error" titulo="No se pudo">
            {error}
          </Aviso>
        )}

        {/* accept="image/*" a secas, como en "subir foto": sin nombrar HEIC el
            iPhone convierte la imagen a JPG antes de entregarla. */}
        <input
          ref={entrada}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void elegirPlano(file)
          }}
        />

        {!tour.plano ? (
          <>
            <Aviso titulo="La planta de la casa">
              Una foto o una imagen del plano arquitectónico. Después marcas dónde está cada
              habitación y hacia dónde mira su foto, y quien vea el recorrido sabrá en qué parte
              de la casa está parado.
            </Aviso>
            <Boton tipo="principal" ancho onClick={() => entrada.current?.click()} disabled={trabajando}>
              {trabajando ? 'Abriendo el plano…' : 'Elegir el plano'}
            </Boton>
          </>
        ) : (
          <>
            {/* `touch-none` en la caja entera y no solo en el alfiler: aquí el
                arrastre empieza sobre un alfiler chico y un dedo gordo lo pierde
                al primer movimiento; la caja no tiene nada más que desplazar. */}
            <div
              ref={caja}
              className="relative w-full touch-none select-none overflow-hidden rounded-hud border
                         border-white/10 bg-black"
            >
              {url ? (
                <img src={url} alt="Plano de la casa" className="block w-full" draggable={false} />
              ) : (
                <div className="grid h-48 place-items-center text-sm text-ink-200">Abriendo el plano…</div>
              )}
              {colocadas.map((s) => {
                const activo = s.id === seleccion
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={`${s.name} en el plano`}
                    aria-pressed={activo}
                    ref={(nodo) => {
                      if (nodo) nodos.current.set(s.id, nodo)
                      else nodos.current.delete(s.id)
                    }}
                    style={{ left: `${s.plano.x * 100}%`, top: `${s.plano.y * 100}%` }}
                    onPointerDown={(event) => alBajar(event, s.id)}
                    onPointerMove={alMover}
                    onPointerUp={alSoltar}
                    onPointerCancel={alCancelar}
                    className="absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-grab
                               touch-none place-items-center active:cursor-grabbing"
                  >
                    {s.plano.giro !== undefined && (
                      <svg
                        viewBox="-40 -40 80 80"
                        className="pointer-events-none absolute h-20 w-20 overflow-visible"
                        aria-hidden
                      >
                        <path
                          d={caminoDelCono(FOV_EDITOR, 34)}
                          transform={`rotate(${s.plano.giro})`}
                          className={`fill-brand-500 ${activo ? 'opacity-50' : 'opacity-30'}`}
                        />
                      </svg>
                    )}
                    <span
                      className={`relative h-4 w-4 rounded-full ring-2 ${
                        activo ? 'bg-brand-500 ring-white' : 'bg-white ring-brand-500'
                      }`}
                    />
                    <span
                      className="pointer-events-none absolute top-full -mt-1 whitespace-nowrap rounded-full
                                 bg-black/60 px-1.5 py-0.5 text-[10px] text-white"
                    >
                      {s.name}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="px-1 text-xs text-ink-200">
              Arrastra cada punto a su lugar en el plano. Toca uno para decir hacia dónde mira su
              foto, o para quitarlo.
            </p>

            {sinColocar.length > 0 && (
              <Tarjeta>
                <p className="mb-2 text-sm font-semibold">Falta colocar</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Habitaciones sin colocar">
                  {sinColocar.map((s) => (
                    <Boton key={s.id} onClick={() => colocar(s.id)}>
                      {s.name}
                    </Boton>
                  ))}
                </div>
                <p className="mt-2 text-xs text-ink-200/70">
                  Aparece en el centro del plano; de ahí la arrastras a su lugar.
                </p>
              </Tarjeta>
            )}

            {elegida && (
              <Tarjeta>
                <p className="mb-1 text-sm font-semibold">{elegida.name}</p>
                {elegida.plano.giro === undefined ? (
                  <>
                    <p className="mb-3 text-xs text-ink-200">
                      Sin cono: el plano enseña dónde está, pero no hacia dónde mira la foto.
                    </p>
                    <Boton ancho onClick={() => girar(elegida.id, 0)}>
                      Indicar hacia dónde mira
                    </Boton>
                  </>
                ) : (
                  <label className="block">
                    <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-ink-200">
                      <span>Hacia dónde mira el frente de la foto</span>
                      <span className="text-ink-50 tabular-nums">{Math.round(elegida.plano.giro)}°</span>
                    </span>
                    {/* h-11: 44 px de alto para el pulgar; un range sin altura mide 20. */}
                    <input
                      type="range"
                      min={0}
                      max={359}
                      step={1}
                      value={Math.round(elegida.plano.giro)}
                      aria-label="Hacia dónde mira el frente de la foto"
                      onChange={(e) => girar(elegida.id, Number(e.target.value))}
                      className="h-11 w-full accent-brand-500"
                    />
                    <span className="mt-1 block text-xs text-ink-200/70">
                      0° es hacia arriba del plano; el cono gira en el sentido del reloj.
                      {elegida.rumbo !== undefined
                        ? ' Las habitaciones tomadas con la cámara que todavía no tienen cono se orientan solas a partir de esta.'
                        : ''}
                    </span>
                  </label>
                )}
                <div className="mt-3 flex gap-2">
                  {elegida.plano.giro !== undefined && (
                    <Boton ancho onClick={() => sinCono(elegida.id)}>
                      Quitar el cono
                    </Boton>
                  )}
                  <Boton tipo="fantasma" ancho onClick={() => sacar(elegida.id)}>
                    Quitar del plano
                  </Boton>
                </div>
              </Tarjeta>
            )}

            <div className="flex gap-2">
              <Boton ancho onClick={() => entrada.current?.click()} disabled={trabajando}>
                {trabajando ? 'Abriendo el plano…' : 'Cambiar el plano'}
              </Boton>
              <Boton tipo="peligro" onClick={() => setConfirmarQuitar(true)}>
                Quitar el plano
              </Boton>
            </div>
            <p className="px-1 text-xs text-ink-200/70">
              Cambiar el plano conserva las posiciones: sirve para un escaneo mejor del mismo plano.
              Quitarlo las borra.
            </p>
          </>
        )}
      </div>

      {confirmarQuitar && (
        <Hoja titulo="¿Quitar el plano?" onCerrar={() => setConfirmarQuitar(false)}>
          <p className="mb-4 text-sm text-ink-200">
            Se quita el plano y dónde estaba cada habitación. Las fotos y los puntos no se tocan.
          </p>
          <div className="flex gap-2">
            <Boton ancho onClick={() => setConfirmarQuitar(false)}>
              Mejor no
            </Boton>
            <Boton tipo="peligro" ancho onClick={() => void quitarPlano()}>
              Sí, quitar
            </Boton>
          </div>
        </Hoja>
      )}
    </Pantalla>
  )
}

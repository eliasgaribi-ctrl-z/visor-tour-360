/* oxlint-disable react/set-state-in-effect -- El efecto sincroniza con
   IndexedDB, que es un sistema externo. */
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'

import { PantallaBoundary } from './components/PantallaBoundary'

import { demoTour } from './data/tour'
import { useHashRoute, recorridoActivo, fijarRecorridoActivo } from './lib/useHashRoute'
import { getTour } from './lib/store/tours'

import { Cargando } from './components/crear/ui'

/**
 * ── Cada pantalla se baja aparte ───────────────────────────────────────────
 *
 * three.js y React Three Fiber pesan un megabyte largo, y hay pantallas que no
 * dibujan ni un píxel en 3D: "Mis recorridos" es una lista, y el editor de un
 * recorrido son unas tarjetas. Con todo en un solo archivo, abrir la lista de
 * recorridos obligaba a descargar el motor gráfico entero antes de pintar el
 * primer renglón — y eso en un celular con datos móviles se siente.
 *
 * El reparto vale igual en el otro sentido, y esa mitad se nos había pasado.
 * Quien recibe el link de una casa entra al visor y no toca jamás las
 * pantallas de crear, pero las venía descargando de todos modos porque eran de
 * las pocas que seguían dentro del archivo de arranque. Bajándolas también por
 * separado, ese archivo pasó de 240.20 a 212.12 kB — 8.64 kB menos ya
 * comprimido, que es lo que de verdad viaja por la red.
 *
 * Con `lazy`, cada una de estas pantallas se descarga la primera vez que se
 * entra a ella y se queda en caché para las siguientes.
 */
const Inicio = lazy(() =>
  import('./components/crear/Inicio').then((m) => ({ default: m.Inicio })),
)
const EditorRecorrido = lazy(() =>
  import('./components/crear/EditorRecorrido').then((m) => ({ default: m.EditorRecorrido })),
)
const TourViewer = lazy(() =>
  import('./components/TourViewer').then((m) => ({ default: m.TourViewer })),
)
const VisorGuardado = lazy(() =>
  import('./components/crear/VisorGuardado').then((m) => ({ default: m.VisorGuardado })),
)
const VisorPublicado = lazy(() =>
  import('./components/crear/VisorPublicado').then((m) => ({ default: m.VisorPublicado })),
)
const EditorPuntos = lazy(() =>
  import('./components/crear/EditorPuntos').then((m) => ({ default: m.EditorPuntos })),
)
const Capturar = lazy(() =>
  import('./components/crear/Capturar').then((m) => ({ default: m.Capturar })),
)
const SubirFoto = lazy(() =>
  import('./components/crear/SubirFoto').then((m) => ({ default: m.SubirFoto })),
)
const Panel = lazy(() => import('./components/crear/Panel').then((m) => ({ default: m.Panel })))
/* La casa leída de su propia carpeta: solo la monta el build de `tools/sitio.mjs`. */
const VisorSitio = lazy(() =>
  import('./components/crear/VisorSitio').then((m) => ({ default: m.VisorSitio })),
)

const PISTA_DEMO = 'Es un ejemplo — toca "Crear el mío" arriba para usar tu cámara'

/**
 * ============================================================================
 *  LAS DOS MITADES DE LA APP
 * ============================================================================
 *
 *   VER    ·  el visor de siempre. Es lo que ve quien recibe el link.
 *   CREAR  ·  las pantallas para armar un recorrido desde el celular.
 *
 * La raíz (`#/`) sigue siendo el VISOR y no el menú, a propósito: el link que
 * se le manda a un cliente para que vea la casa no debe abrir en una pantalla
 * de administración. Quien sí está creando entra al menú con el botón de la
 * barra de arriba, que es un toque.
 */
export default function App() {
  const { ruta, ir } = useHashRoute()

  /** Qué recorrido abre la raíz: el último que se vio, o la demo. */
  const [inicial, setInicial] = useState<string | null | 'demo'>(null)

  useEffect(() => {
    // En el sitio autocontenido no hay recorrido activo que buscar: ni toca IndexedDB.
    if (ruta.nombre !== 'visor' || import.meta.env.VITE_SITIO) return
    let vivo = true
    void (async () => {
      const id = recorridoActivo()
      if (!id) {
        if (vivo) setInicial('demo')
        return
      }
      const guardado = await getTour(id)
      if (!vivo) return
      if (!guardado || guardado.scenes.length === 0) {
        fijarRecorridoActivo(null)
        setInicial('demo')
      } else {
        setInicial(id)
      }
    })()
    return () => {
      vivo = false
    }
  }, [ruta.nombre])

  const alMenu = useCallback(() => ir({ nombre: 'inicio' }), [ir])

  /** Estable a propósito: VisorGuardado la usa dentro de un efecto. */
  const alFallarElActivo = useCallback(() => {
    fijarRecorridoActivo(null)
    setInicial('demo')
  }, [])

  /**
   * Botón de la barra superior en la demo: el mismo destino que el antiguo
   * ícono de menú ("Mis recorridos"), pero con texto y color de marca. Quien
   * recibe el link de GitHub Pages cae aquí primero, y sin una salida visible
   * se queda pensando que esto ES el producto — en vez de un ejemplo con
   * panorámicas sintéticas, y de que su propio recorrido, con la cámara del
   * teléfono, está a un toque de distancia.
   */
  const botonCrear = (
    <button
      type="button"
      onClick={alMenu}
      className="hud-glass pointer-events-auto flex h-16 shrink-0 items-center gap-2 rounded-hud
                 bg-brand-500 px-4 text-sm font-semibold text-[var(--tinta-marca,#000)] active:bg-brand-600"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path
          d="M4 8.5A1.5 1.5 0 0 1 5.5 7h1.6l.9-1.5A1 1 0 0 1 8.86 5h6.28a1 1 0 0 1 .86.5L16.9 7h1.6A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="13" r="3.2" />
      </svg>
      Crear el mío
    </button>
  )

  const pantalla = () => {
    /* ── El sitio autocontenido ─────────────────────────────────────────────
     *
     * Con `VITE_SITIO` (el build que arma `tools/sitio.mjs`) esta app ES una
     * casa, y cualquier ruta la enseña. No hay "mis recorridos" que listar, y el
     * link que se le da a un comprador no debe abrir la administración de nadie
     * aunque le agreguen `#/inicio` a mano. En el build normal la variable no
     * existe y esta línea desaparece. */
    if (import.meta.env.VITE_SITIO) return <VisorSitio />

    switch (ruta.nombre) {
      case 'inicio':
        return <Inicio ir={ir} />

      case 'editar':
        return <EditorRecorrido tourId={ruta.tourId} ir={ir} />

      case 'capturar':
        return <Capturar tourId={ruta.tourId} sceneId={ruta.sceneId} ir={ir} />

      case 'foto':
        return <SubirFoto tourId={ruta.tourId} sceneId={ruta.sceneId} ir={ir} />

      case 'puntos':
        return <EditorPuntos tourId={ruta.tourId} sceneId={ruta.sceneId} ir={ir} />

      case 'ver':
        /* ── `key` y no solo la prop ──────────────────────────────────────────
         *
         * `VisorGuardado` guarda DOS cosas en estado: el recorrido que leyó de
         * IndexedDB y si la persona ya entró (o sea, si la portada ya se pasó).
         * Al navegar de `#/ver/A` a `#/ver/B` React lo mantiene montado porque
         * ocupa la misma posición del árbol, así que los dos estados se quedan
         * con lo de A: el recorrido B se abría SIN portada —saltándose el
         * precio, la dirección y el contacto, que es la pantalla que vende— y
         * mientras cargaba mostraba los datos de A bajo el id de B.
         *
         * Con `key` React lo desmonta y lo monta de nuevo, que es lo correcto
         * para otro recorrido: son otras texturas y otra marca. */
        return <VisorGuardado key={ruta.tourId} tourId={ruta.tourId} ir={ir} />

      /* La casa publicada. A diferencia de 'ver', no se busca en el teléfono:
         se descarga. Es la ruta por la que entra un cliente que nunca ha usado
         esta app y que llegó por un link de WhatsApp. */
      case 'publicado':
        // El mismo `key` que en 'ver', por lo mismo: otra llave es otra casa.
        return <VisorPublicado key={ruta.llave} llave={ruta.llave} ir={ir} />

      case 'demo':
        return <TourViewer tour={demoTour} accion={botonCrear} pista={PISTA_DEMO} />

      /* Las casas publicadas con el código de la inmobiliaria, desde cualquier
         teléfono. Como 'publicado', no toca IndexedDB. */
      case 'panel':
        return <Panel ir={ir} />

      case 'visor':
      default:
        if (inicial === null) return <Cargando texto="Abriendo…" />
        if (inicial === 'demo') return <TourViewer tour={demoTour} accion={botonCrear} pista={PISTA_DEMO} />
        return (
          <VisorGuardado key={inicial} tourId={inicial} ir={ir} alFallar={alFallarElActivo} />
        )
    }
  }

  /* La frontera va POR FUERA del Suspense: si el trozo perezoso no se puede
     descargar, la promesa se rechaza y sin nadie que lo atrape React tira el
     árbol entero y deja la pantalla en negro. Ver PantallaBoundary. */
  return (
    <PantallaBoundary>
      <Suspense fallback={<Cargando texto="Abriendo…" />}>{pantalla()}</Suspense>
    </PantallaBoundary>
  )
}

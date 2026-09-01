/* oxlint-disable react/set-state-in-effect -- El efecto sincroniza con
   IndexedDB, que es un sistema externo. */
import { useCallback, useEffect, useState } from 'react'

import { demoTour } from './data/tour'
import { useHashRoute, recorridoActivo, fijarRecorridoActivo } from './lib/useHashRoute'
import { getTour } from './lib/store/tours'

import { TourViewer } from './components/TourViewer'
import { Inicio } from './components/crear/Inicio'
import { EditorRecorrido } from './components/crear/EditorRecorrido'
import { EditorPuntos } from './components/crear/EditorPuntos'
import { Capturar } from './components/crear/Capturar'
import { SubirFoto } from './components/crear/SubirFoto'
import { VisorGuardado } from './components/crear/VisorGuardado'
import { Cargando } from './components/crear/ui'

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
    if (ruta.nombre !== 'visor') return
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

  const botonMenu = (
    <button
      type="button"
      onClick={alMenu}
      aria-label="Mis recorridos"
      className="hud-glass pointer-events-auto grid h-16 w-11 place-items-center rounded-hud text-ink-50
                 active:bg-white/15"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
      </svg>
    </button>
  )

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
      return <VisorGuardado tourId={ruta.tourId} ir={ir} />

    case 'demo':
      return <TourViewer tour={demoTour} accion={botonMenu} />

    case 'visor':
    default:
      if (inicial === null) return <Cargando texto="Abriendo…" />
      if (inicial === 'demo') return <TourViewer tour={demoTour} accion={botonMenu} />
      return (
        <VisorGuardado tourId={inicial} ir={ir} alFallar={alFallarElActivo} />
      )
  }
}

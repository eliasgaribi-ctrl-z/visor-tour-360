/* oxlint-disable react/set-state-in-effect -- El efecto sincroniza con
   IndexedDB, que es un sistema externo. */
import { useEffect, useState } from 'react'

import type { Tour } from '../../lib/types'
import type { Ruta } from '../../lib/useHashRoute'
import { getTour, resolveTour } from '../../lib/store/tours'
import { fijarRecorridoActivo } from '../../lib/useHashRoute'
import { TourViewer } from '../TourViewer'
import { Aviso, Boton, Cargando, Pantalla } from './ui'

export type VisorGuardadoProps = {
  tourId: string
  ir: (ruta: Ruta) => void
  /**
   * Si el recorrido no existe, a dónde caer en vez de mostrar un error.
   * TIENE que ser estable (useCallback): entra en las dependencias del efecto
   * que abre el recorrido, y una función nueva en cada render lo dispararía sin
   * parar.
   */
  alFallar?: () => void
}

/** Abre un recorrido guardado en el teléfono y lo muestra con el visor de siempre. */
export function VisorGuardado({ tourId, ir, alFallar }: VisorGuardadoProps) {
  const [tour, setTour] = useState<Tour | null | 'no-existe' | 'vacio'>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      const guardado = await getTour(tourId)
      if (!vivo) return
      if (!guardado) {
        setTour('no-existe')
        alFallar?.()
        return
      }
      const resuelto = await resolveTour(guardado)
      if (!vivo) return
      if (resuelto.scenes.length === 0) {
        setTour('vacio')
        return
      }
      fijarRecorridoActivo(tourId)
      setTour(resuelto)
    })()
    return () => {
      vivo = false
    }
  }, [alFallar, tourId])

  if (tour === null) {
    return (
      <Pantalla titulo="Recorrido" atras={() => ir({ nombre: 'inicio' })}>
        <Cargando texto="Abriendo el recorrido…" />
      </Pantalla>
    )
  }

  if (tour === 'no-existe' || tour === 'vacio') {
    return (
      <Pantalla titulo="Recorrido" atras={() => ir({ nombre: 'inicio' })}>
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          <Aviso tono="error" titulo={tour === 'vacio' ? 'Todavía no hay nada' : 'No se encontró'}>
            {tour === 'vacio'
              ? 'Este recorrido no tiene ninguna habitación con foto. Agrega la primera y vuelve.'
              : 'Este recorrido no está guardado en este teléfono.'}
          </Aviso>
          <Boton
            tipo="principal"
            ancho
            onClick={() =>
              tour === 'vacio' ? ir({ nombre: 'editar', tourId }) : ir({ nombre: 'inicio' })
            }
          >
            {tour === 'vacio' ? 'Agregar habitación' : 'Ver mis recorridos'}
          </Boton>
        </div>
      </Pantalla>
    )
  }

  return (
    <TourViewer
      tour={tour}
      accion={
        <button
          type="button"
          onClick={() => ir({ nombre: 'editar', tourId })}
          aria-label="Editar el recorrido"
          className="hud-glass pointer-events-auto grid h-16 w-11 place-items-center rounded-hud
                     text-ink-50 active:bg-white/15"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 20h4l10-10a2.8 2.8 0 10-4-4L4 16v4z" strokeLinejoin="round" />
          </svg>
        </button>
      }
    />
  )
}

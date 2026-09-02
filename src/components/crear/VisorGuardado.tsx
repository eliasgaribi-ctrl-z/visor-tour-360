/* oxlint-disable react/set-state-in-effect -- El efecto sincroniza con
   IndexedDB, que es un sistema externo. */
import { Suspense, lazy, useEffect, useState } from 'react'

import type { Tour } from '../../lib/types'
import type { Ruta } from '../../lib/useHashRoute'
import { getTour, resolveTour } from '../../lib/store/tours'
import { fijarRecorridoActivo } from '../../lib/useHashRoute'
import { aplicarMarca } from '../../lib/marca'
import { Portada } from '../tour/Portada'
import { Aviso, Boton, Cargando, Pantalla } from './ui'

/**
 * El visor se baja aparte, y aquí eso importa más que en `App.tsx`.
 *
 * Con un `import` normal, three.js y React Three Fiber —~1.1 MB— entran en el
 * mismo trozo que esta pantalla, así que la portada NO podría pintarse hasta que
 * el motor 3D terminara de bajar. O sea que el beneficio de tener portada
 * (mostrar la casa mientras se espera) desaparecería justo por la forma de
 * importar. Con `lazy`, la portada pinta de inmediato y el motor viaja en
 * paralelo.
 *
 * Y `precargarVisor()` es la misma promesa pedida por su efecto secundario: se
 * dispara al mostrar la portada, así que mientras la persona lee el precio y los
 * metros, el motor ya está bajando. Cuando toca "Ver el recorrido", suele estar.
 */
const TourViewer = lazy(() => import('../TourViewer').then((m) => ({ default: m.TourViewer })))

const precargarVisor = () => {
  void import('../TourViewer')
}

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
  /**
   * ¿Ya entró al recorrido?
   *
   * Solo importa cuando hay portada. Un recorrido sin `ficha` no la muestra —una
   * portada vacía es peor que ninguna— así que ahí este estado no se usa.
   */
  const [entro, setEntro] = useState(false)

  /**
   * ============================================================================
   *  UN SOLO DUEÑO DE LA MARCA
   * ============================================================================
   *
   * `aplicarMarca` escribe en `:root`, que es un global. Estaba llamada desde DOS
   * componentes —`Portada` y `TourViewer`— cada uno con su limpieza al
   * desmontarse, y eso causaba exactamente el parpadeo que sus comentarios decían
   * evitar: React desmonta la portada ANTES de montar el visor, así que la
   * limpieza de la portada corría primero y dejaba un hueco sin marca.
   *
   * Medido con un recorrido de marca morada, muestreando `--color-brand-500` por
   * cuadro al tocar "Ver el recorrido":
   *
   *     #7c3aed ×3  →  #e19100 ×18  →  #7c3aed …
   *
   * Dieciocho cuadros del ámbar de THIQA en medio del recorrido de otra
   * inmobiliaria. Dos dueños de un global es un dueño de más.
   *
   * Ahora vive aquí, que es el componente que contiene LAS DOS pantallas: se
   * aplica una vez y se limpia al salir del recorrido, que es cuando de verdad
   * deja de aplicar. El visor de la demo (`App.tsx` monta `TourViewer` directo)
   * no pasa por aquí, y no le hace falta: `demoTour` no trae marca.
   */
  const marca = tour !== null && typeof tour === 'object' ? tour.marca : undefined
  useEffect(() => {
    aplicarMarca(marca)
    return () => aplicarMarca(undefined)
  }, [marca])

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

  const editar = (
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
  )

  /* La portada se muestra ANTES del visor cuando el recorrido trae datos de la
     casa. Dos cosas se ganan con eso, y la segunda no es obvia:

       · el comprador ve precio, metros y dirección antes de entrar, que es lo
         que decide si entra;
       · y la portada monta SIN WebGL, así que en un iPhone con iOS 13 o 14 —donde
         el visor 3D no puede funcionar— al menos ve la casa y el botón para
         llamar al agente, en vez de solo el mensaje de ViewerGuard.

     Mientras se lee la ficha, `precargarVisor()` ya está bajando el chunk de
     three.js: leer no cuesta tiempo. */
  if (tour.ficha && !entro) {
    precargarVisor()
    return (
      <Portada
        titulo={tour.title}
        subtitulo={tour.subtitle}
        ficha={tour.ficha}
        marca={tour.marca}
        fondo={tour.scenes[0]?.thumbnail ?? tour.scenes[0]?.image}
        onEntrar={() => setEntro(true)}
        accion={editar}
      />
    )
  }

  /* Suspense propio y no el de App.tsx: si el motor todavía no llegó, aquí se
     puede decir "Abriendo el recorrido…" en vez de dejar que la frontera de
     arriba tire la pantalla entera. */
  return (
    <Suspense
      fallback={
        <Pantalla titulo={tour.title} atras={() => ir({ nombre: 'inicio' })}>
          <Cargando texto="Abriendo el recorrido…" />
        </Pantalla>
      }
    >
      <TourViewer tour={tour} accion={editar} />
    </Suspense>
  )
}

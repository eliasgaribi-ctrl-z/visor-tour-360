import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'

import type { Tour } from '../../lib/types'
import { aplicarMarca } from '../../lib/marca'
import { Cargando } from '../crear/ui'
import { Portada } from './Portada'

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

export type ConPortadaProps = {
  tour: Tour
  /** El botón de la esquina: editar, "crear el mío"… Va en la portada y en el visor. */
  accion?: ReactNode
  /** La pista de arranque del visor. */
  pista?: string
  /** Qué enseñar mientras baja el motor 3D. Por omisión, un "Abriendo…". */
  fallback?: ReactNode
}

/**
 * ============================================================================
 *  PORTADA + VISOR, Y UN SOLO DUEÑO DE LA MARCA
 * ============================================================================
 *
 * La costura entre la ficha de la casa y el recorrido en 3D. Antes vivía dentro
 * de `VisorGuardado`; la sacó el segundo llamador —`VisorPublicado`, la casa que
 * llega por link— porque el comprador que abre un link es EXACTAMENTE para quien
 * se construyó la portada, y la casa publicada abría directo en la foto.
 *
 * La portada se muestra ANTES del visor cuando el recorrido trae datos de la
 * casa. Dos cosas se ganan con eso, y la segunda no es obvia:
 *
 *   · el comprador ve precio, metros y dirección antes de entrar, que es lo
 *     que decide si entra;
 *   · y la portada monta SIN WebGL, así que en un iPhone con iOS 13 o 14 —donde
 *     el visor 3D no puede funcionar— al menos ve la casa y el botón para
 *     llamar al agente, en vez de solo el mensaje de ViewerGuard.
 *
 * Un recorrido sin `ficha` no la muestra: una portada vacía es peor que ninguna.
 *
 * ── La marca ────────────────────────────────────────────────────────────────
 *
 * `aplicarMarca` escribe en `:root`, que es un global. Estuvo llamada desde DOS
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
 * inmobiliaria. Dos dueños de un global es un dueño de más. Vive aquí, que es
 * el componente que contiene LAS DOS pantallas: se aplica una vez y se limpia al
 * salir del recorrido, que es cuando de verdad deja de aplicar. El visor de la
 * demo (`App.tsx` monta `TourViewer` directo) no pasa por aquí, y no le hace
 * falta: `demoTour` no trae marca.
 */
export function ConPortada({ tour, accion, pista, fallback }: ConPortadaProps) {
  /** ¿Ya entró al recorrido? Solo importa cuando hay portada. */
  const [entro, setEntro] = useState(false)

  const marca = tour.marca
  useEffect(() => {
    aplicarMarca(marca)
    return () => aplicarMarca(undefined)
  }, [marca])

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
        accion={accion}
      />
    )
  }

  /* Suspense propio y no el de App.tsx: si el motor todavía no llegó, aquí se
     puede decir "Abriendo el recorrido…" en vez de dejar que la frontera de
     arriba tire la pantalla entera. */
  return (
    <Suspense fallback={fallback ?? <Cargando texto="Abriendo el recorrido…" />}>
      <TourViewer tour={tour} accion={accion} pista={pista} />
    </Suspense>
  )
}

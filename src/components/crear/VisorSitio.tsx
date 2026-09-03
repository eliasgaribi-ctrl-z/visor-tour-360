/* oxlint-disable react/set-state-in-effect -- El efecto sincroniza con la red,
   que es un sistema externo. */
import { useEffect, useState } from 'react'

import type { Tour } from '../../lib/types'
import { asset } from '../../lib/assets'
import { aparato } from '../../lib/dispositivo'
import { PublicarError, manifiestoATour } from '../../lib/publicar'
import { ConPortada } from '../tour/ConPortada'
import { Aviso, Boton, Cargando, Pantalla } from './ui'

/**
 * Dónde deja `tools/sitio.mjs` la casa, relativo al `index.html`:
 *
 *   recorrido/tour.json        el manifiesto: el mismo v2 que baja del Worker
 *   recorrido/fotos/000.jpg    las fotos, con los nombres que dice el manifiesto
 *   recorrido/fotos/logo.png   el logo, si la marca trae
 *
 * No se exporta a propósito: un archivo que exporta un componente y además
 * constantes rompe el refresco en caliente (y el lint lo avisa). La herramienta
 * tiene su propia copia del nombre, y `sitio.mjs` comprueba que coincidan.
 */
const CARPETA = 'recorrido'

/**
 * ============================================================================
 *  LA CASA COMO SITIO PROPIO: SIN WORKER, SIN NADA NUESTRO
 * ============================================================================
 *
 * Es la tercera forma de abrir una casa, y la respuesta a la objeción de venta
 * "¿y si ustedes cierran?". `VisorGuardado` la busca en IndexedDB;
 * `VisorPublicado` la baja del Worker; este la lee de SU PROPIA CARPETA:
 * `tools/sitio.mjs` deja el visor compilado y el recorrido juntos, y esa carpeta
 * se sube a cualquier hosting estático —el de la inmobiliaria, el que sea— y
 * sigue abriendo aunque el Worker no exista.
 *
 * Solo existe en el build con `VITE_SITIO`; `App.tsx` lo monta para CUALQUIER
 * ruta, porque en ese sitio no hay "mis recorridos" ni pantallas de crear que
 * enseñar. Y no crea métricas: no hay a quién reportarlas, y esa es la idea.
 *
 * Las direcciones son RELATIVAS (`./recorrido/…`, vía `asset()` con la base
 * `./` del build), así que la carpeta funciona bajo cualquier subcarpeta del
 * dominio, igual que el sitio de GitHub Pages.
 */
export function VisorSitio() {
  const [estado, setEstado] = useState<
    { fase: 'cargando' } | { fase: 'listo'; tour: Tour } | { fase: 'error'; mensaje: string; consejo?: string }
  >({ fase: 'cargando' })
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let vivo = true
    setEstado({ fase: 'cargando' })
    void (async () => {
      try {
        const tour = await abrirSitio()
        if (!vivo) return
        setEstado({ fase: 'listo', tour })
      } catch (e) {
        if (!vivo) return
        setEstado({
          fase: 'error',
          mensaje: e instanceof PublicarError ? e.message : 'No se pudo abrir la casa.',
          consejo: e instanceof PublicarError ? e.consejo : undefined,
        })
      }
    })()
    return () => {
      vivo = false
    }
  }, [intento])

  if (estado.fase === 'cargando') {
    return (
      <Pantalla titulo="Recorrido">
        <Cargando texto="Abriendo la casa…" />
      </Pantalla>
    )
  }

  if (estado.fase === 'error') {
    return (
      <Pantalla titulo="Recorrido">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          <Aviso tono="error" titulo="No se pudo abrir">
            {estado.mensaje}
            {estado.consejo ? ` ${estado.consejo}` : ''}
          </Aviso>
          <Boton tipo="principal" ancho onClick={() => setIntento((n) => n + 1)}>
            Volver a intentar
          </Boton>
        </div>
      </Pantalla>
    )
  }

  return <ConPortada tour={estado.tour} />
}

/**
 * Lee `recorrido/tour.json` de la propia carpeta y lo vuelve el `Tour` del
 * visor, con las fotos apuntando a `recorrido/fotos/` en relativo.
 *
 * Pasa por `manifiestoATour`, o sea por los mismos filtros que un manifiesto
 * del Worker o un `.tour` ajeno: el archivo lo escribió la herramienta a partir
 * de un `.tour`, y un `.tour` lo pudo editar cualquiera.
 */
async function abrirSitio(): Promise<Tour> {
  let respuesta: Response
  try {
    respuesta = await fetch(asset(`${CARPETA}/tour.json`))
  } catch {
    throw new PublicarError('No se pudo leer el recorrido.', 'Revisa que haya internet y vuelve a intentar.')
  }
  if (!respuesta.ok) {
    throw new PublicarError(
      `Falta el recorrido en este sitio (${respuesta.status}).`,
      'La carpeta "recorrido" tiene que estar junto al index.html, como la dejó tools/sitio.mjs.',
    )
  }
  return manifiestoATour('sitio', await respuesta.json(), {
    anchoTextura: aparato().anchoTextura,
    base: asset(`${CARPETA}/fotos`),
  })
}

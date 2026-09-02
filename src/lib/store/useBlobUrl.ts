/* oxlint-disable react/set-state-in-effect -- El efecto sincroniza con
   IndexedDB, que es un sistema externo. */
import { useEffect, useState } from 'react'

import { blobUrl } from './tours'

/**
 * Llave de un Blob guardado → URL `blob:` que un `<img>` puede mostrar.
 *
 * Devuelve `null` mientras la busca, si no hay llave, o si el Blob ya no está en
 * la base (foto borrada a mano, importación incompleta). Quien la use tiene que
 * aguantar el `null`: es un cuadro o dos, no un error.
 *
 * Estaba escrito tres veces, palabra por palabra, en `Inicio.tsx` (la portada de
 * cada recorrido), `EditorRecorrido.tsx` (la miniatura de cada habitación) y
 * `EditorPuntos.tsx` (la foto de fondo del editor). Las tres copias traían la
 * misma bandera `vivo` para no llamar a `setState` después de desmontarse.
 *
 * ── OJO: aquí NO se revoca nada ────────────────────────────────────────────
 *
 * La tentación al ver un hook así es soltar la URL en la limpieza del efecto.
 * Sería un error: `blobUrl()` cachea por llave de Blob y mantiene las URLs vivas
 * toda la sesión a propósito, porque el caché de texturas
 * (`src/lib/useEquirectTexture.ts`) está indexado POR URL. Revocarla aquí haría
 * que la siguiente apertura creara una URL nueva para la misma foto y la
 * subiera otra vez a la tarjeta gráfica — justo lo que ese caché existe para
 * evitar. Quien de verdad quiera soltarla usa `releaseBlobUrl()` de `tours.ts`,
 * que es para cuando la foto se reemplaza o se borra.
 */
export function useBlobUrl(imageId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!imageId) {
      setUrl(null)
      return
    }
    let vivo = true
    void blobUrl(imageId).then((u) => {
      if (vivo) setUrl(u)
    })
    return () => {
      vivo = false
    }
  }, [imageId])

  return url
}

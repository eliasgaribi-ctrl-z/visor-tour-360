import type { Hotspot } from '../types'

/**
 * ============================================================================
 *  MODELO DE LO QUE SE GUARDA EN EL TELÉFONO
 * ============================================================================
 *
 * Hay DOS modelos de recorrido y conviene no confundirlos:
 *
 *   Tour        (src/lib/types.ts)  ·  el que consume el visor.
 *                                     `image` es una URL que el navegador puede
 *                                     descargar: /panoramas/sala.jpg, blob:… o data:…
 *
 *   StoredTour  (este archivo)      ·  el que vive en IndexedDB.
 *                                     `imageId` es la LLAVE de un Blob guardado
 *                                     aparte, no una URL.
 *
 * Se guardan así, separados, por dos razones:
 *   · un Blob de 1.5 MB dentro del JSON del recorrido obligaría a leer y
 *     reescribir todas las fotos cada vez que se renombra una habitación;
 *   · las URLs `blob:` mueren al recargar la página, así que no se pueden
 *     guardar: hay que volver a crearlas al abrir el recorrido.
 *
 * `resolveTour()` (en ./tours.ts) es el puente entre los dos.
 */

/** Cómo llegó la foto al recorrido. Solo informativo, para la UI. */
export type SceneOrigin = 'captura' | 'foto'

export type StoredScene = {
  id: string
  name: string
  /** Llave del Blob de la equirectangular 2:1 en el store de imágenes. */
  imageId: string
  /** Llave del Blob de la miniatura (JPEG chico). */
  thumbId?: string
  /** Yaw al entrar a la habitación, en grados. */
  initialYaw?: number
  hotspots: Hotspot[]
  origin?: SceneOrigin
  /** Grados de círculo que cubre la foto: 360 = esfera completa. */
  coverageDeg?: number
  createdAt: number
}

export type StoredTour = {
  id: string
  title: string
  subtitle?: string
  startSceneId: string
  scenes: StoredScene[]
  createdAt: number
  updatedAt: number
}

/** Fila del listado de recorridos: lo mínimo para pintar la portada. */
export type TourSummary = {
  id: string
  title: string
  subtitle?: string
  scenes: number
  updatedAt: number
  /** Llave del Blob de la miniatura de la primera habitación. */
  coverId?: string
}

export const FORMAT_VERSION = 1

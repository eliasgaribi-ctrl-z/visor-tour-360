import type { StoredScene, StoredTour } from './types'

/**
 * ============================================================================
 *  NORMALIZAR LO QUE SALE DE INDEXEDDB
 * ============================================================================
 *
 * Vive en su propio módulo, separado de `migrar.ts`, y la razón es de PESO y está
 * medida: `getTour()` llama a esto, y `getTour()` lo usa la pantalla "Mis
 * recorridos" — o sea que todo lo que esté en este archivo entra en el chunk de
 * arranque, que el proyecto mantiene acotado a propósito (README §10).
 *
 * `limpiarMarca` y `limpiarFicha`, en cambio, solo las necesitan el importador de
 * `.tour` y el editor. Tenerlas en el mismo archivo metía ~4 kB en el arranque de
 * una pantalla que solo pinta una lista. Se midió: 242,471 bytes juntas contra
 * 236,7xx separadas.
 *
 * ── Por qué hace falta esto ────────────────────────────────────────────────
 *
 * Los registros de IndexedDB NO se re-validan nunca. `getTour()` devolvía lo que
 * hubiera en la base, tal cual, así que un `StoredTour` escrito por una versión
 * anterior de esta misma app llega con los campos nuevos ausentes directo a los
 * componentes — y el fallo aparece lejos de la causa: un `undefined.length`
 * dentro de un render, meses después.
 */

/**
 * Deja un registro de IndexedDB en la forma que los componentes esperan.
 *
 * Barato a propósito: si el registro ya está bien —el caso normal— devuelve el
 * MISMO objeto, sin copiarlo. Así se puede llamar en cada `getTour()` sin pensar
 * en el costo, y las comparaciones por identidad de React siguen funcionando.
 */
export function normalizarTour(tour: StoredTour): StoredTour {
  const escenas = tour.scenes
  const escenasOk =
    Array.isArray(escenas) &&
    escenas.every(
      (s) => s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.hotspots),
    )

  if (escenasOk && typeof tour.startSceneId === 'string' && tour.startSceneId) {
    return tour
  }

  const arregladas: StoredScene[] = (Array.isArray(escenas) ? escenas : [])
    .filter((s): s is StoredScene => !!s && typeof s.imageId === 'string')
    .map((s, i) => ({
      ...s,
      id: typeof s.id === 'string' && s.id ? s.id : `esc-${i}`,
      name: typeof s.name === 'string' && s.name ? s.name : 'Habitación',
      hotspots: Array.isArray(s.hotspots) ? s.hotspots : [],
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : 0,
    }))

  return {
    ...tour,
    scenes: arregladas,
    startSceneId:
      typeof tour.startSceneId === 'string' && arregladas.some((s) => s.id === tour.startSceneId)
        ? tour.startSceneId
        : (arregladas[0]?.id ?? ''),
  }
}

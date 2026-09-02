import type { StoredTour } from '../../lib/store/types'

/**
 * Nombre que se propone para una habitación nueva.
 *
 * Va recorriendo los cuartos de una casa en el orden en que la gente los
 * recorre, y se salta los que ya existen en el recorrido; cuando se acaban, cae
 * en "Habitación N". La comparación es en minúsculas porque quien ya escribió
 * "sala" a mano no debería recibir otra "Sala" de sugerencia.
 *
 * Vive en su propio módulo, y no en `ui.tsx`, porque `ui.tsx` solo exporta
 * componentes y meterle una función suelta dispara la regla
 * `react/only-export-components` de oxlint. Estaba duplicada palabra por palabra
 * en Capturar.tsx y en SubirFoto.tsx, que son las dos formas de agregar una
 * habitación: si alguien cambiara la lista en una, la otra se quedaría vieja.
 */
export function sugerirNombre(tour: StoredTour | null): string {
  const usados = new Set((tour?.scenes ?? []).map((s) => s.name.toLowerCase()))
  for (const nombre of ['Sala', 'Cocina', 'Comedor', 'Recámara', 'Baño', 'Patio', 'Cochera']) {
    if (!usados.has(nombre.toLowerCase())) return nombre
  }
  return `Habitación ${(tour?.scenes.length ?? 0) + 1}`
}

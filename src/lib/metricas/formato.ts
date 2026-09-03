import type { StoredTour } from '../store/types'

/**
 * Lo que la hoja de visitas necesita para LEERSE, aparte del componente: cómo
 * se escribe un tiempo y cómo se llama cada id. En su propio módulo y no dentro
 * de `Visitas.tsx` porque un archivo que exporta un componente y además
 * funciones rompe el refresco en caliente de Vite (y el lint lo avisa).
 */

/** "45 s", "1 min", "1 min 20 s". Para el tiempo en cada habitación. */
export function duracion(segundos: number): string {
  const s = Math.round(segundos)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m} min ${r} s` : `${m} min`
}

/**
 * Los nombres con los que se enseñan las habitaciones y los puntos de un
 * resumen: id → nombre. Sale del recorrido guardado (el editor); el panel lo
 * recibe ya armado del servidor, a partir del manifiesto publicado.
 */
export function nombresDe(tour: Pick<StoredTour, 'scenes'>): Record<string, string> {
  const nombres: Record<string, string> = {}
  for (const s of tour.scenes) {
    nombres[s.id] = s.name
    for (const h of s.hotspots) nombres[h.id] = h.label || h.id
  }
  return nombres
}

/**
 * Puente para avisar que una URL de foto dejó de existir.
 *
 * ── Por qué existe este archivo tan chico ──────────────────────────────────
 *
 * El almacén de recorridos necesita decirle al caché de texturas "olvida esta
 * URL" cuando revoca un blob. Pero si `store/tours.ts` importara directamente
 * `useEquirectTexture.ts`, se traería a three.js entero con él, y entonces la
 * pantalla de "Mis recorridos" —que no dibuja ni un píxel en 3D— tendría que
 * descargar el megabyte del motor gráfico antes de pintar una lista.
 *
 * Con esta indirección, el caché se anuncia cuando alguien lo carga, y el
 * almacén le habla solo si está ahí. Si nadie ha abierto una escena todavía, no
 * hay nada que olvidar y la llamada no hace nada.
 */

let olvidar: ((url: string) => void) | null = null

/** Lo llama el caché de texturas al cargarse. */
export function registrarOlvido(fn: (url: string) => void) {
  olvidar = fn
}

/** Lo llama el almacén cuando revoca una URL. */
export function olvidarTextura(url: string) {
  olvidar?.(url)
}

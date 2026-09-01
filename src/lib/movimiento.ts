/**
 * ¿Este aparato pidió menos movimiento?
 *
 * En iOS es "Reducir movimiento" y en Android "Quitar animaciones"; en los dos
 * casos el navegador lo expone como `prefers-reduced-motion: reduce`. Quien lo
 * enciende no está pidiendo una interfaz más sobria: hay gente a la que un
 * paneo suave o un fundido a pantalla completa le provoca mareo de verdad. Un
 * visor 360 es de lo peor en ese sentido, porque el movimiento ocupa TODA la
 * pantalla y no hay un borde quieto donde descansar la vista.
 *
 * ── Por qué una función y no una constante ─────────────────────────────────
 *
 * El ajuste se puede cambiar con la aplicación abierta (en iOS está a dos
 * toques en el centro de control). Leerlo una sola vez al arrancar dejaría al
 * visor moviéndose igual hasta recargar la página.
 *
 * ── Por qué se guarda el MediaQueryList ────────────────────────────────────
 *
 * `CameraRig` pregunta esto en CADA cuadro, o sea hasta 120 veces por segundo.
 * `matchMedia()` crea un objeto nuevo cada vez que se llama, y eso es basura
 * que alguien tiene que recoger justo mientras se dibuja. El objeto se crea
 * una vez y se le pregunta `.matches`, que es una lectura viva: si el ajuste
 * cambia, el siguiente cuadro ya lo ve, sin escuchar ningún evento.
 */

let consulta: MediaQueryList | null = null

export function menosMovimiento(): boolean {
  // En una prueba con jsdom o al pintar en el servidor no hay matchMedia.
  if (typeof matchMedia !== 'function') return false
  consulta ??= matchMedia('(prefers-reduced-motion: reduce)')
  return consulta.matches
}

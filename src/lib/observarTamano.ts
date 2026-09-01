/**
 * ============================================================================
 *  ¿DE QUÉ TAMAÑO ES ESTA CAJA, Y CUÁNDO CAMBIA?
 * ============================================================================
 *
 * `ResizeObserver` es lo correcto, pero llegó en Safari 13.1 / iOS 13.4. El
 * proyecto compila para Safari 13, así que en iOS 13.0 a 13.3 —dentro del piso
 * que declaramos— `new ResizeObserver(...)` es un ReferenceError.
 *
 * Y ese error no es cosmético. Los dos sitios que lo usan están FUERA de
 * cualquier frontera de error (la del canvas solo envuelve al `<Canvas>`, y
 * estos componentes son sus hermanos), así que la excepción sube hasta la raíz
 * y React desmonta la aplicación entera: pantalla vacía, sin mensaje. Encima la
 * red de seguridad de index.html tampoco avisa, porque solo mira si `#root`
 * quedó sin hijos y para entonces ya había montado.
 *
 * El respaldo no observa la caja: observa la VENTANA. Es menos preciso —no se
 * entera si la caja cambia de tamaño sin que cambie la ventana— pero en estas
 * dos pantallas la caja ocupa siempre la pantalla completa, así que en la
 * práctica es el mismo evento.
 */
export function observarTamano(elemento: Element, alCambiar: () => void): () => void {
  if (typeof ResizeObserver !== 'undefined') {
    const observador = new ResizeObserver(alCambiar)
    observador.observe(elemento)
    return () => observador.disconnect()
  }

  window.addEventListener('resize', alCambiar)
  window.addEventListener('orientationchange', alCambiar)
  return () => {
    window.removeEventListener('resize', alCambiar)
    window.removeEventListener('orientationchange', alCambiar)
  }
}

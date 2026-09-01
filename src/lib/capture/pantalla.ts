/**
 * Mantener la pantalla encendida durante la captura.
 *
 * Una habitación completa son unos dos minutos girando sin tocar el teléfono, y
 * el tiempo de bloqueo de pantalla de casi cualquier celular es menor. Sin esto,
 * la pantalla se apaga a media panorámica y la cámara se corta.
 *
 * `navigator.wakeLock` existe en Chrome de Android y en Safari 16.4 en
 * adelante. Donde no existe, no pasa nada: la captura sigue, solo que el
 * usuario tiene que tocar la pantalla de vez en cuando.
 *
 * El candado se SUELTA solo cuando la página pasa a segundo plano, así que hay
 * que volver a pedirlo al regresar; si no, la segunda mitad de la captura se
 * queda sin él.
 */
export function mantenerPantallaEncendida(): () => void {
  type Candado = { release: () => Promise<void>; released: boolean }
  type ConWakeLock = Navigator & {
    wakeLock?: { request: (tipo: 'screen') => Promise<Candado> }
  }

  const api = (navigator as ConWakeLock).wakeLock
  if (!api) return () => {}

  let candado: Candado | null = null
  let vivo = true

  const pedir = async () => {
    if (!vivo || candado) return
    try {
      candado = await api.request('screen')
      if (!vivo) {
        void candado.release()
        candado = null
      }
    } catch {
      // Batería baja o pestaña en segundo plano: se reintenta al volver.
      candado = null
    }
  }

  const alVolver = () => {
    if (document.visibilityState === 'visible') {
      candado = null
      void pedir()
    }
  }

  void pedir()
  document.addEventListener('visibilitychange', alVolver)

  return () => {
    vivo = false
    document.removeEventListener('visibilitychange', alVolver)
    void candado?.release().catch(() => undefined)
    candado = null
  }
}

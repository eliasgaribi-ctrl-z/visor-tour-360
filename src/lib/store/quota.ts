/**
 * Espacio de almacenamiento del navegador.
 *
 * Un recorrido de 8 habitaciones a 4096×2048 pesa unos 12 MB. Eso cabe de
 * sobra, pero el navegador puede BORRAR los datos solo si el teléfono se queda
 * sin espacio (y Safari en iOS también los borra si el sitio pasa siete días
 * sin abrirse). `navigator.storage.persist()` pide que no lo haga; en Chrome se
 * concede si el usuario instaló el sitio o lo visita seguido, y en Safari
 * depende de que lo agregue a la pantalla de inicio.
 *
 * Por eso el recorrido SIEMPRE se puede exportar a un archivo: es el respaldo
 * que no depende del navegador.
 */

export type StorageInfo = {
  /** Bytes usados por este sitio, si el navegador los reporta. */
  usage?: number
  /** Bytes disponibles en total, si el navegador los reporta. */
  quota?: number
  /** El navegador se comprometió a no borrar los datos por falta de espacio. */
  persistent: boolean
  supported: boolean
}

export async function storageInfo(): Promise<StorageInfo> {
  const storage = navigator.storage
  if (!storage?.estimate) return { persistent: false, supported: false }

  try {
    const { usage, quota } = await storage.estimate()
    const persistent = (await storage.persisted?.()) ?? false
    return { usage, quota, persistent, supported: true }
  } catch {
    return { persistent: false, supported: false }
  }
}

/** Pide que el navegador no borre los recorridos guardados. No siempre se concede. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

/** "12.4 MB" — para mostrarle al usuario cuánto lleva ocupado. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

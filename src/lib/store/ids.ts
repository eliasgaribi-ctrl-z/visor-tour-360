/**
 * Identificadores cortos y únicos, sin dependencias.
 *
 * `crypto.randomUUID()` solo existe en contexto seguro (https o localhost).
 * Como el editor puede abrirse en un http de la red local —donde la cámara no
 * sirve pero el resto sí— hay dos escalones de respaldo.
 */
export function newId(prefix = 'id'): string {
  const c = globalThis.crypto

  if (typeof c?.randomUUID === 'function') {
    return `${prefix}_${c.randomUUID().replace(/-/g, '').slice(0, 16)}`
  }

  if (typeof c?.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(8))
    let out = ''
    for (const b of bytes) out += b.toString(16).padStart(2, '0')
    return `${prefix}_${out}`
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

/**
 * Convierte un texto libre en algo usable como id legible ("Sala grande" →
 * "sala-grande"). Se le pega un sufijo aleatorio para que dos habitaciones con
 * el mismo nombre no choquen.
 */
export function slugId(text: string, prefix = 'esc'): string {
  const slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return slug ? `${slug}-${newId(prefix).slice(-6)}` : newId(prefix)
}

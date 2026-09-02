import type { Ficha, Marca } from '../types'
import type { MarcaGuardada } from './types'

/**
 * ============================================================================
 *  MIGRACIÓN Y NORMALIZACIÓN
 * ============================================================================
 *
 * Dos trabajos parecidos que conviene no confundir:
 *
 *   migrarRecorrido()   ·  un manifiesto que viene de un ARCHIVO `.tour`, y que
 *                          pudo escribirlo una versión vieja del visor — o
 *                          editarlo alguien a mano.
 *   normalizarTour()    ·  un registro que sale de IndexedDB, escrito por una
 *                          versión anterior de ESTA misma app.
 *
 * ── Por qué hace falta el segundo, que es el que no existía ────────────────
 *
 * `importarTour` ya toleraba lo viejo, pero con `??` dispersos en cada campo. Lo
 * que nadie cubría es que **los registros de IndexedDB no se re-validan nunca**:
 * `getTour()` devolvía lo que hubiera en la base, tal cual. Un `StoredTour`
 * escrito hoy y leído por el código de mañana llega con los campos nuevos
 * ausentes directo a los componentes, y el fallo aparece lejos de la causa — un
 * `undefined.length` dentro de un render, meses después.
 *
 * Con `normalizarTour()` dentro de `getTour()` hay UN punto de entrada para
 * todos sus consumidores, y el defaulting deja de estar repartido.
 *
 * ── La regla del formato publicado, para cuando llegue ─────────────────────
 *
 * Los campos son ADITIVOS y nunca se borran ni se reutilizan. Un campo
 * desconocido se ignora. Eso es lo que permite que un visor cacheado de la
 * semana pasada abra un recorrido nuevo sin romperse: verá menos, no verá mal.
 */

/** Un color solo se acepta si es un hex que cualquier navegador entiende. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function texto(v: unknown, max = 200): string | undefined {
  if (typeof v !== 'string') return undefined
  const limpio = v.trim().slice(0, max)
  return limpio || undefined
}

function entero(v: unknown, max = 99): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  const n = Math.round(v)
  return n >= 0 && n <= max ? n : undefined
}

function color(v: unknown): string | undefined {
  return typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : undefined
}

/**
 * Limpia una marca que viene de fuera.
 *
 * Se filtra campo por campo en vez de confiar en el objeto entero, y no por
 * paranoia: estos valores acaban dentro de un `style.setProperty()`, así que un
 * string arbitrario es una inyección de CSS. Un hex validado no lo es.
 */
export function limpiarMarca(crudo: unknown): MarcaGuardada | undefined {
  if (!crudo || typeof crudo !== 'object') return undefined
  const m = crudo as Record<string, unknown>
  const colores = (m.colores ?? {}) as Record<string, unknown>

  const limpia: MarcaGuardada = {}
  const nombre = texto(m.nombre, 60)
  if (nombre) limpia.nombre = nombre

  const paleta: NonNullable<Marca['colores']> = {}
  for (const clave of ['brand300', 'brand400', 'brand500', 'brand600', 'ink50', 'ink200', 'ink700', 'ink900'] as const) {
    const c = color(colores[clave])
    if (c) paleta[clave] = c
  }
  if (Object.keys(paleta).length > 0) limpia.colores = paleta

  const hud = color(m.hudFondo)
  if (hud) limpia.hudFondo = hud
  const fondo = color(m.fondoApp)
  if (fondo) limpia.fondoApp = fondo

  if (m.tipografia === 'sistema' || m.tipografia === 'serif' || m.tipografia === 'geometrica') {
    limpia.tipografia = m.tipografia
  }
  const logoId = texto(m.logoId, 80)
  if (logoId) limpia.logoId = logoId

  return Object.keys(limpia).length > 0 ? limpia : undefined
}

/** Limpia una ficha que viene de fuera. Todo texto se acota. */
export function limpiarFicha(crudo: unknown): Ficha | undefined {
  if (!crudo || typeof crudo !== 'object') return undefined
  const f = crudo as Record<string, unknown>
  const agenteCrudo = (f.agente ?? {}) as Record<string, unknown>

  const ficha: Ficha = {}
  const precio = texto(f.precio, 40)
  if (precio) ficha.precio = precio
  const superficie = texto(f.superficie, 40)
  if (superficie) ficha.superficie = superficie
  const recamaras = entero(f.recamaras, 20)
  if (recamaras !== undefined) ficha.recamaras = recamaras
  const banos = entero(f.banos, 20)
  if (banos !== undefined) ficha.banos = banos
  const direccion = texto(f.direccion, 160)
  if (direccion) ficha.direccion = direccion
  const descripcion = texto(f.descripcion, 600)
  if (descripcion) ficha.descripcion = descripcion

  const agente: NonNullable<Ficha['agente']> = {}
  const nombre = texto(agenteCrudo.nombre, 80)
  if (nombre) agente.nombre = nombre
  const telefono = texto(agenteCrudo.telefono, 30)
  if (telefono) agente.telefono = telefono
  // Solo dígitos: es lo que espera el enlace de wa.me.
  const whatsapp = texto(agenteCrudo.whatsapp, 20)?.replace(/\D/g, '')
  if (whatsapp) agente.whatsapp = whatsapp
  const correo = texto(agenteCrudo.correo, 120)
  if (correo) agente.correo = correo
  if (Object.keys(agente).length > 0) ficha.agente = agente

  return Object.keys(ficha).length > 0 ? ficha : undefined
}

/**
 * La escalera de versiones del manifiesto, un peldaño por función.
 *
 * Explícita y no un montón de `??` sueltos: cuando llegue la v3 se agrega
 * `de2a3` y se ve de un golpe qué cambió en cada salto. Con el defaulting
 * disperso, el tercer salto es donde se rompe.
 */
function de1a2(recorrido: Record<string, unknown>): Record<string, unknown> {
  // v1 no tenía marca ni ficha, y las dos son opcionales: no hay nada que
  // rellenar. El peldaño existe igual, para que el salto quede documentado y
  // para tener dónde poner lo que sí haga falta la próxima vez.
  return recorrido
}

/**
 * Deja el `recorrido` de un manifiesto en la forma de la versión actual.
 *
 * Se llama UNA vez, justo después de validar el formato y la versión, para que
 * de ahí en adelante el resto de `importarTour` solo vea la forma de hoy.
 */
export function migrarRecorrido(
  recorrido: Record<string, unknown>,
  version: number,
): Record<string, unknown> {
  let actual = recorrido
  if (version < 2) actual = de1a2(actual)
  return actual
}


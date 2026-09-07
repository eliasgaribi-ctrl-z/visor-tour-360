import type { PosicionEnPlano } from './types'
import { clamp, DEG, wrap360 } from './math'

/**
 * ============================================================================
 *  LA PLANTA ARQUITECTÓNICA: DÓNDE ESTÁ CADA CUARTO Y HACIA DÓNDE SE MIRA
 * ============================================================================
 *
 * Un comprador que no sabe si la recámara da al patio no compra. El plano de la
 * casa con un punto por habitación y un cono de "hacia aquí estás mirando" es
 * lo que responde esa pregunta sin tener que recorrer todo.
 *
 * Todo lo que aquí se calcula es geometría plana y vive aparte del componente
 * para poder probarse sin navegador (`planta.test.ts`).
 *
 * ── Las convenciones, que es donde se equivoca uno ─────────────────────────
 *
 *   · Posición `(x, y)` NORMALIZADA a [0, 1] sobre la imagen del plano, con el
 *     origen arriba a la izquierda, como el DOM. No en píxeles: así el plano se
 *     puede cambiar por un escaneo mejor sin recolocar nada.
 *   · `giro`: grados en el SENTIDO DEL RELOJ desde "arriba" del plano a los que
 *     mira el yaw 0 de la panorámica. Es la orientación de la foto SOBRE EL
 *     PLANO, no un rumbo geográfico: un plano no siempre tiene el norte arriba,
 *     y una foto importada no tiene rumbo. Sin `giro` no se dibuja cono.
 *   · El cono apunta a `giro + yaw`: girar la cámara a la derecha (yaw positivo,
 *     la convención de todo el proyecto) es girar en el sentido del reloj visto
 *     desde arriba, y `rotate()` en pantalla también es en el sentido del reloj.
 *     Es el mismo signo que la brújula, al revés: allá gira el DISCO para que el
 *     norte quede quieto (`-(yaw + rumbo)`), aquí gira la CÁMARA sobre un plano
 *     quieto (`+(yaw + giro)`).
 *
 * ── El regalo del rumbo ────────────────────────────────────────────────────
 *
 * Las fotos capturadas con el teléfono traen `rumbo` (a qué rumbo real mira su
 * frente). Dos habitaciones con rumbo se orientan ENTRE SÍ sin que nadie haga
 * nada: si la sala mira al rumbo 70 y en el plano su frente apunta a 90°, un
 * cuarto que mira al rumbo 160 apunta en el plano a 90 + (160 − 70) = 180°. Así
 * que el agente orienta UNA habitación con el control y las demás capturadas se
 * orientan solas. Es exactamente para lo que se guardó el rumbo.
 */

/** Grados del cono de vista que se dibuja con un fov fuera de rango. */
const CONO_MIN = 10
const CONO_MAX = 170

/** La posición de un dedo o un cursor, en coordenadas del plano [0, 1]. */
export function posicionEnPlano(
  clientX: number,
  clientY: number,
  caja: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (caja.width <= 0 || caja.height <= 0) return { x: 0.5, y: 0.5 }
  return {
    x: clamp((clientX - caja.left) / caja.width, 0, 1),
    y: clamp((clientY - caja.top) / caja.height, 0, 1),
  }
}

/** Hacia dónde apunta el cono en el plano: la orientación de la foto más lo que giró la cámara. */
export function anguloDelCono(yaw: number, giro: number): number {
  return wrap360(giro + yaw)
}

/** Una habitación que ya sabe hacia dónde mira en el plano Y en el mundo. */
export type ReferenciaDeGiro = { rumbo: number; giro: number }

/**
 * El giro que le toca a una habitación con `rumbo`, a partir de otra que ya
 * tiene rumbo y giro: la diferencia de rumbos reales es la misma diferencia de
 * ángulos sobre el plano, porque el plano es rígido.
 */
export function giroHeredado(rumbo: number, referencia: ReferenciaDeGiro): number {
  return wrap360(referencia.giro + (rumbo - referencia.rumbo))
}

/** La primera habitación que puede servir de referencia para las demás, o `null`. */
export function referenciaDeGiro(
  escenas: ReadonlyArray<{ id: string; rumbo?: number; plano?: PosicionEnPlano }>,
  exceptoId?: string,
): ReferenciaDeGiro | null {
  for (const e of escenas) {
    if (e.id === exceptoId) continue
    if (e.rumbo !== undefined && e.plano?.giro !== undefined) return { rumbo: e.rumbo, giro: e.plano.giro }
  }
  return null
}

/**
 * El sector del cono de vista como `d` de un `<path>` SVG, con el vértice en el
 * origen y apuntando hacia arriba (−y). Quien lo dibuja lo rota con
 * `anguloDelCono`; el fov solo cambia la apertura, así que se recalcula solo
 * cuando el fov cambia de verdad (ver `Minimapa`).
 */
export function caminoDelCono(fovDeg: number, radio: number): string {
  const medio = (clamp(fovDeg, CONO_MIN, CONO_MAX) / 2) * DEG
  const x = (Math.sin(medio) * radio).toFixed(2)
  const y = (-Math.cos(medio) * radio).toFixed(2)
  /* De la orilla izquierda a la derecha pasando por arriba: en coordenadas de
     pantalla (y hacia abajo) eso es el sentido del reloj, sweep-flag 1. */
  return `M0 0 L-${x} ${y} A${radio} ${radio} 0 0 1 ${x} ${y} Z`
}

/* ── Lo que viene de fuera ─────────────────────────────────────────────────── */

/** Un número que pudo llegar como texto. La misma regla que `migrar.ts`. */
function numero(v: unknown): number | undefined {
  const n = typeof v === 'string' ? (v.trim() === '' ? NaN : Number(v)) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/**
 * La posición de una habitación tal como viene de un archivo o de la red:
 * acotada a la imagen, con el giro al círculo. Sin `x` o sin `y` no hay
 * posición; el giro es opcional y no se inventa.
 */
export function limpiarPosicion(crudo: unknown): PosicionEnPlano | undefined {
  if (!crudo || typeof crudo !== 'object') return undefined
  const p = crudo as Record<string, unknown>
  const x = numero(p.x)
  const y = numero(p.y)
  if (x === undefined || y === undefined) return undefined
  const posicion: PosicionEnPlano = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) }
  const giro = numero(p.giro)
  if (giro !== undefined) posicion.giro = wrap360(giro)
  return posicion
}

/** El tamaño más grande que se acepta declarar para un plano, en píxeles. */
const LADO_MAXIMO = 16384

/**
 * El plano tal como lo nombra un manifiesto: el archivo (una entrada del ZIP o
 * un nombre en el servidor; quien llama decide qué forma admite) y su tamaño en
 * enteros positivos. Sin las tres cosas no hay plano.
 */
export function limpiarPlano(crudo: unknown): { archivo: string; ancho: number; alto: number } | undefined {
  if (!crudo || typeof crudo !== 'object') return undefined
  const p = crudo as Record<string, unknown>
  const archivo = typeof p.archivo === 'string' ? p.archivo.trim().slice(0, 255) : ''
  const ancho = numero(p.ancho)
  const alto = numero(p.alto)
  if (!archivo || ancho === undefined || alto === undefined) return undefined
  const a = Math.round(ancho)
  const b = Math.round(alto)
  if (a < 1 || b < 1 || a > LADO_MAXIMO || b > LADO_MAXIMO) return undefined
  return { archivo, ancho: a, alto: b }
}

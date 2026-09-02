/**
 * ============================================================================
 *  MATEMÁTICA ESCALAR  ·  CERO DEPENDENCIAS, A PROPÓSITO
 * ============================================================================
 *
 * Ángulos y utilidades numéricas. Este archivo NO importa three.js, y eso no es
 * casualidad: es la razón de que exista separado de `math3d.ts`.
 *
 * `DEG` es `Math.PI / 180`. Vivía en el mismo módulo que las proyecciones, que
 * sí necesitan three — así que ocho módulos que solo querían esa constante (el
 * arrastre, el plan de captura, el costurero, que hace su propio WebGL a mano)
 * arrastraban el motor 3D entero a su grafo de imports. Vite llegó a bautizar el
 * chunk de three.js como "math" justamente por eso.
 *
 * La regla, entonces: si algo de aquí llega a necesitar un `Vector3`, no va
 * aquí. Va en `math3d.ts`.
 *
 * ── Convención de ángulos de TODO el proyecto (grados, no radianes) ─────────
 *   yaw   →  rotación horizontal. 0 = frente inicial. Positivo = a la DERECHA.
 *   pitch →  inclinación vertical. 0 = horizonte. Positivo = ARRIBA (±85°).
 */

export const DEG = Math.PI / 180

export const clamp = (v: number, min: number, max: number) =>
  v < min ? min : v > max ? max : v

/**
 * Interpolación exponencial independiente del framerate.
 * Un `lerp(a, b, 0.1)` dentro de useFrame corre distinto a 60fps que a 120fps;
 * esto no. lambda alto = respuesta más seca.
 */
export const damp = (current: number, target: number, lambda: number, dt: number) => {
  // Es `THREE.MathUtils.damp` escrito a mano, con su fórmula exacta
  // (`lerp(a, b, 1 - e^(-lambda·dt))`). Se copiaron tres líneas a propósito,
  // para que este módulo no tenga que importar three solo por esto.
  const k = 1 - Math.exp(-lambda * dt)
  return current * (1 - k) + target * k
}

/** Normaliza un ángulo en grados al rango [0, 360). Solo para mostrar (brújula). */
export const wrap360 = (deg: number) => ((deg % 360) + 360) % 360

/** Normaliza un ángulo en grados al rango (-180, 180]. */
export const wrap180 = (deg: number) => {
  const a = wrap360(deg + 180) - 180
  return a === -180 ? 180 : a
}

/**
 * Diferencia angular más corta entre dos yaws (en grados), en (-180, 180].
 * Necesaria para animar hacia un yaw destino sin dar la vuelta larga.
 */
export const shortestDelta = (from: number, to: number) => wrap180(to - from)


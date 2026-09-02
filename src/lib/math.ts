/**
 * ============================================================================
 *  MATEMÁTICA ESCALAR  ·  CERO DEPENDENCIAS, A PROPÓSITO
 * ============================================================================
 *
 * Ángulos y utilidades numéricas. Este archivo NO importa three.js, y eso no es
 * casualidad: es la razón de que exista separado de `math3d.ts`.
 *
 * `DEG` es `Math.PI / 180`, y vivía en el mismo módulo que las proyecciones, que
 * sí necesitan three. Ocho módulos importaban de ahí solo escalares, y con eso
 * metían three en su grafo de imports: por eso Vite llegó a bautizar el chunk del
 * motor 3D como "math".
 *
 * ── Lo que este split ahorró de verdad, que es menos de lo que parece ──────
 *
 * De esos ocho, uno —`EditorPuntos.tsx`— importaba escalares Y proyecciones, así
 * que no cuenta en ninguna de las dos columnas de abajo. De los siete restantes,
 * CUATRO ya importaban three por su cuenta y siguen igual:
 * `Capturar.tsx`, `capture/stitcher.ts` (que construye un `THREE.WebGLRenderer`),
 * `capture/orientation.ts` y `capture/importar.ts`. Los que de verdad quedaron
 * libres son tres: `useDragLook.ts`, `capture/plan.ts` y `capture/frames.ts`.
 *
 * Y el peso de descarga NO bajó: el chunk de arranque pasó de 236,304 a 236,309
 * bytes, o sea +5. Se mide, no se supone. Lo que se ganó es que el chunk de
 * 725 kB dejara de llamarse "math" y que un módulo escalar nuevo ya no pueda
 * arrastrar three sin querer — la trampa que creó el nombre engañoso.
 *
 * (Se dice aquí porque otros archivos remiten a este encabezado como la fuente
 * de verdad. Una versión anterior ponía al costurero como ejemplo estrella de
 * módulo liberado, y es justo uno de los cuatro que no lo fueron.)
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


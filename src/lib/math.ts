import * as THREE from 'three'

export const DEG = Math.PI / 180

export const clamp = (v: number, min: number, max: number) =>
  v < min ? min : v > max ? max : v

/**
 * Interpolación exponencial independiente del framerate.
 * Un `lerp(a, b, 0.1)` dentro de useFrame corre distinto a 60fps que a 120fps;
 * esto no. lambda alto = respuesta más seca.
 */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  THREE.MathUtils.damp(current, target, lambda, dt)

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

/**
 * (yaw, pitch) en grados → punto sobre una esfera de radio r, en coordenadas de three.js.
 *
 * Se deriva de la orientación que aplica el CameraRig
 * (Euler YXZ con rotation.y = -yaw y rotation.x = +pitch) sobre el forward (0,0,-1):
 *
 *   x =  cos(pitch) · sin(yaw)
 *   y =  sin(pitch)
 *   z = -cos(pitch) · cos(yaw)
 *
 * Gracias a esto, un hotspot con yaw = 30 aparece exactamente 30° a la derecha
 * del frente de la escena.
 */
export const yawPitchToVector3 = (
  yawDeg: number,
  pitchDeg: number,
  radius = 1,
  out = new THREE.Vector3(),
) => {
  const yaw = yawDeg * DEG
  const pitch = pitchDeg * DEG
  const cp = Math.cos(pitch)
  return out.set(cp * Math.sin(yaw), Math.sin(pitch), -cp * Math.cos(yaw)).multiplyScalar(radius)
}

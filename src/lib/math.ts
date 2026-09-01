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

/**
 * Inversa de `yawPitchToVector3`: dirección en three.js → (yaw, pitch) en grados.
 *
 *   yaw   = atan2(x, -z)
 *   pitch = asin(y / |v|)
 */
export const vector3ToYawPitch = (v: THREE.Vector3) => {
  const length = v.length() || 1
  return {
    yaw: Math.atan2(v.x, -v.z) / DEG,
    pitch: Math.asin(clamp(v.y / length, -1, 1)) / DEG,
  }
}

/**
 * Punto de la PANTALLA → dirección (yaw, pitch) de la escena.
 *
 * Es exactamente la inversa de la proyección que hace HotspotLayer, y es lo que
 * permite "toca la foto y ahí queda el punto" en el editor:
 *
 *   1. píxel → NDC,
 *   2. NDC → rayo en espacio de cámara, con la distancia focal f = 1/tan(fov/2),
 *   3. rayo → mundo, aplicando la MISMA rotación (Euler YXZ) que el CameraRig,
 *   4. mundo → (yaw, pitch).
 *
 * `x`/`y` van en píxeles relativos al contenedor, no a la ventana.
 */
export const screenToYawPitch = (
  x: number,
  y: number,
  width: number,
  height: number,
  camera: { yaw: number; pitch: number; fov: number },
  out = new THREE.Vector3(),
) => {
  const aspect = width / height
  const focal = 1 / Math.tan((camera.fov * DEG) / 2)

  const ndcX = (x / width) * 2 - 1
  const ndcY = 1 - (y / height) * 2

  // Rayo en espacio de cámara: la cámara mira hacia -Z.
  out.set((ndcX * aspect) / focal, ndcY / focal, -1).normalize()

  // A mundo, con la misma orientación que aplica el CameraRig.
  out.applyEuler(new THREE.Euler(camera.pitch * DEG, -camera.yaw * DEG, 0, 'YXZ'))

  return vector3ToYawPitch(out)
}

export type CamaraVista = { yaw: number; pitch: number; fov: number }

const _euler = new THREE.Euler(0, 0, 0, 'YXZ')
const _quat = new THREE.Quaternion()
const _dir = new THREE.Vector3()

/**
 * (yaw, pitch) de la escena → punto de la PANTALLA.
 *
 * Es la ida de `screenToYawPitch`, y la usan tanto los hotspots del visor como
 * los puntos guía de la captura. Vive aquí, en un solo lugar, porque es la
 * fórmula donde un signo al revés se nota como "el marcador aparece del lado
 * contrario" y hay que poder arreglarlo una vez, no dos.
 *
 * Devuelve null si la dirección queda DETRÁS de la cámara: sin ese corte, la
 * división de la perspectiva devuelve un punto reflejado que aparecería en
 * pantalla como un marcador fantasma en el lado opuesto.
 */
export const yawPitchToScreen = (
  yawDeg: number,
  pitchDeg: number,
  camera: CamaraVista,
  width: number,
  height: number,
): { x: number; y: number } | null => {
  const aspect = width / height
  const focal = 1 / Math.tan((camera.fov * DEG) / 2)

  _euler.set(camera.pitch * DEG, -camera.yaw * DEG, 0, 'YXZ')
  _quat.setFromEuler(_euler).invert()
  yawPitchToVector3(yawDeg, pitchDeg, 1, _dir).applyQuaternion(_quat)

  if (_dir.z > -0.05) return null

  const ndcX = (_dir.x / -_dir.z) * (focal / aspect)
  const ndcY = (_dir.y / -_dir.z) * focal
  return { x: (ndcX * 0.5 + 0.5) * width, y: (1 - (ndcY * 0.5 + 0.5)) * height }
}

/**
 * (yaw, pitch) → pantalla, pero orientando la cámara con un CUATERNIÓN completo.
 *
 * La versión de arriba arma la orientación con yaw y pitch nada más, que es
 * todo lo que necesita el visor: ahí la cámara nunca se ladea. La captura sí
 * necesita el ladeo, porque el teléfono va en la mano del usuario y casi nunca
 * está perfectamente derecho; sin el roll, los puntos guía se despegarían de lo
 * que se ve en la pantalla en cuanto alguien inclina un poco la muñeca.
 *
 * `inversa` es la orientación de la cámara YA invertida (mundo → cámara), que
 * es lo que de verdad se usa, y así no se recalcula en cada punto.
 */
export const yawPitchToScreenQ = (
  yawDeg: number,
  pitchDeg: number,
  inversa: THREE.Quaternion,
  fovVerticalDeg: number,
  width: number,
  height: number,
  out = new THREE.Vector3(),
): { x: number; y: number } | null => {
  const aspect = width / height
  const focal = 1 / Math.tan((fovVerticalDeg * DEG) / 2)

  yawPitchToVector3(yawDeg, pitchDeg, 1, out).applyQuaternion(inversa)
  if (out.z > -0.02) return null

  const ndcX = (out.x / -out.z) * (focal / aspect)
  const ndcY = (out.y / -out.z) * focal
  return { x: (ndcX * 0.5 + 0.5) * width, y: (1 - (ndcY * 0.5 + 0.5)) * height }
}

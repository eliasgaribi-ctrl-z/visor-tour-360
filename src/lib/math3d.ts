/**
 * ============================================================================
 *  MATEMÁTICA 3D  ·  proyecciones escena <-> pantalla
 * ============================================================================
 *
 * Lo que estaba en `math.ts` y sí necesita three.js. Separado para que quien
 * solo quiera `DEG` o `clamp` no arrastre el motor 3D a su chunk: la razón
 * completa está en el encabezado de `math.ts`.
 *
 * Misma convención de ángulos que allá: grados, yaw 0 al frente y positivo a la
 * derecha, pitch 0 en el horizonte y positivo hacia arriba.
 */
import * as THREE from 'three'

import { DEG, clamp } from './math'

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
 * Umbral de "está detrás de la cámara" del visor.
 *
 * La captura usa -0.02 y el visor -0.05, y la diferencia no es descuido: en el
 * visor cada marcador es un botón de 44 px, y esconderlo un poco antes de que la
 * división de la perspectiva se vuelva loca se ve mejor que dejarlo estirarse
 * hacia el borde. En la captura los puntos guía son mira fina y conviene que
 * duren hasta el último momento.
 */
export const CORTE_VISOR = -0.05

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
  // El visor nunca ladea la cámara, así que la orientación se arma con yaw y
  // pitch nada más; el resto lo hace `yawPitchToScreenQ`, que es la ÚNICA copia
  // de la fórmula que queda en el proyecto.
  _euler.set(camera.pitch * DEG, -camera.yaw * DEG, 0, 'YXZ')
  _quat.setFromEuler(_euler).invert()
  return yawPitchToScreenQ(yawDeg, pitchDeg, _quat, camera.fov, width, height, _dir, CORTE_VISOR)
}

/** Umbral de "está detrás de la cámara" del visor. Ver `yawPitchToScreen`. */
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
 * es lo que de verdad se usa, y así no se recalcula en cada punto. Quien proyecta
 * muchos puntos por cuadro —los hotspots del visor, los puntos guía— la calcula
 * una vez fuera del bucle y la pasa: eso es la razón de que esta versión exista
 * además de `yawPitchToScreen`.
 *
 * `corte` es el umbral de "detrás de la cámara". El default -0.02 es el de la
 * captura; el visor pasa `CORTE_VISOR`. Ver el comentario de esa constante.
 */
export const yawPitchToScreenQ = (
  yawDeg: number,
  pitchDeg: number,
  inversa: THREE.Quaternion,
  fovVerticalDeg: number,
  width: number,
  height: number,
  out = new THREE.Vector3(),
  corte = -0.02,
): { x: number; y: number } | null => {
  const aspect = width / height
  const focal = 1 / Math.tan((fovVerticalDeg * DEG) / 2)

  yawPitchToVector3(yawDeg, pitchDeg, 1, out).applyQuaternion(inversa)
  if (out.z > corte) return null

  const ndcX = (out.x / -out.z) * (focal / aspect)
  const ndcY = (out.y / -out.z) * focal
  return { x: (ndcX * 0.5 + 0.5) * width, y: (1 - (ndcY * 0.5 + 0.5)) * height }
}

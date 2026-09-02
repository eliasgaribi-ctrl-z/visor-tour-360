import type * as THREE from 'three'
import { shortestDelta } from './math'
import { angleBetween } from './capture/orientation'

/**
 * ============================================================================
 *  LA ARITMÉTICA DEL GIROSCOPIO, EN FUNCIONES QUE SE PUEDEN PROBAR
 * ============================================================================
 *
 * `CameraRig` aplica esto cuadro por cuadro y `useGyroLook` decide qué lecturas
 * llegan hasta ahí. Las dos viven dentro de React y de three, donde una prueba
 * unitaria no llega; estas cuatro funciones son puras y `useGyroLook.test.ts`
 * las cubre. Un signo al revés aquí no revienta nada: solo hace que encender el
 * sensor pegue un latigazo de media vuelta, o que cruzar el sur dé la vuelta
 * entera. Eso se descubre en un teléfono girando, o aquí en medio segundo.
 *
 *   objetivo = yaw del sensor (desenvuelto) + offset
 */

/** Grados que una lectura tiene que apartarse de la última aplicada para contar. Ver useGyroLook. */
export const ZONA_MUERTA = 0.15

/**
 * El offset que hace que encender el sensor NO mueva la cámara: el objetivo
 * actual se queda como está, y desde ahí la mano manda.
 */
export function offsetSinSalto(targetYaw: number, sensorYaw: number): number {
  return targetYaw - sensorYaw
}

/**
 * El yaw del sensor llega envuelto a (-180, 180]; el objetivo del rig crece sin
 * límite. Acumular por el camino corto hace que 179° → -179° sea un paso de 2° y
 * no una vuelta entera de suavizado.
 */
export function desenvolver(acumulado: number, nuevo: number): number {
  return acumulado + shortestDelta(acumulado, nuevo)
}

/**
 * Un cambio de habitación con el sensor al mando no mueve el objetivo —lo
 * dicta un teléfono que está donde está— sino la habitación debajo: el offset se
 * corre por el camino corto para que el sensor quede apuntando al destino.
 */
export function offsetHacia(sensorYaw: number, offset: number, destino: number): number {
  return offset + shortestDelta(sensorYaw + offset, destino)
}

/**
 * La zona muerta. `null` es "todavía no se aplicó ninguna": la primera lectura
 * siempre pasa, porque es la que fija el offset sin salto.
 */
export function hayQueAplicar(
  ultima: THREE.Quaternion | null,
  lectura: THREE.Quaternion,
  zona = ZONA_MUERTA,
): boolean {
  return ultima === null || angleBetween(ultima, lectura) >= zona
}

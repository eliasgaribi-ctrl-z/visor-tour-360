import * as THREE from 'three'

import { DEG, clamp } from './math.ts'

/**
 * ============================================================================
 *  CORRECCIÓN DE NIVEL: ENDEREZAR EL HORIZONTE AL VER
 * ============================================================================
 *
 * ── Qué problema es, y cuál NO es ─────────────────────────────────────────
 *
 * El README decía "enderezar el horizonte de una panorámica capturada a pulso,
 * ya que el ladeo de cada toma se conoce". Se conoce, sí, y **ya se aplica**:
 * `stitcher.ts` mete el cuaternión completo de cada toma —ladeo incluido— en la
 * proyección inversa, así que una panorámica capturada sale nivelada contra la
 * gravedad que reporta el acelerómetro. Lo que queda son dos cosas distintas:
 *
 *   1. un error GLOBAL de referencia de gravedad, de 1 a 3 grados, y
 *   2. las fotos IMPORTADAS, sin ningún dato de sensor, con ladeos de 5 a 8.
 *
 * Para las dos, el lugar correcto es corregir AL VER —rotando la esfera con un
 * cuaternión— y no en la costura: es reversible, es gratis, y sirve igual para
 * una foto que no tiene tomas que recoser. Y por lo mismo **no hay semilla
 * automática**: sembrar el nivel con el ladeo de las tomas duplicaría la
 * corrección que el costurero ya hizo. El nivel arranca en cero y lo ajusta el
 * agente mirando la foto.
 *
 * ── Dos ángulos y no uno ──────────────────────────────────────────────────
 *
 * Un error de referencia de gravedad es una rotación de eje HORIZONTAL, y un eje
 * horizontal tiene dos grados de libertad. Con un solo ángulo se endereza el
 * frente y se deja torcido el costado. `tiltX` gira alrededor del eje X del
 * mundo (el horizonte sube o baja al frente) y `tiltZ` alrededor del eje Z (el
 * horizonte se ladea a izquierda o derecha). En grados, y acotados a ±15: más
 * que eso no es un error de nivel, es otra foto.
 *
 * ── El signo se fija con la prueba, no a ojo ──────────────────────────────
 *
 * `tools/pruebas/nivel.mjs` fabrica una panorámica sintética con el horizonte
 * marcado, la ladea con una rotación conocida, y mide con `amplitudDelHorizonte`
 * que la corrección de aquí lo devuelve a cero — y que el signo contrario lo
 * duplica. Es exactamente el tipo de error que al revés se ve como "se ve peor y
 * nadie sabe por qué".
 */

export type Nivel = { tiltX: number; tiltZ: number }

/** Más allá de esto no es nivel: es otra foto. */
export const NIVEL_MAXIMO = 15

const _euler = new THREE.Euler()

/**
 * La rotación que hay que aplicarle a la ESFERA para que la foto quede a nivel.
 *
 * Orden XZY a propósito: primero el ladeo de frente (X), luego el lateral (Z),
 * y nunca el eje Y, que sería girar la foto y eso ya lo hace `initialYaw`.
 */
export function cuaternionDeNivel(nivel: Nivel | undefined, out = new THREE.Quaternion()): THREE.Quaternion {
  if (!nivel) return out.identity()
  _euler.set(
    clamp(nivel.tiltX, -NIVEL_MAXIMO, NIVEL_MAXIMO) * DEG,
    0,
    clamp(nivel.tiltZ, -NIVEL_MAXIMO, NIVEL_MAXIMO) * DEG,
    'XZY',
  )
  return out.setFromEuler(_euler)
}

const _antes = new THREE.Quaternion()
const _despues = new THREE.Quaternion()
const _dir = new THREE.Vector3()

/**
 * Un punto (yaw, pitch) que se colocó con el nivel `antes`, ¿a dónde va con el
 * nivel `despues` para seguir sobre lo mismo de la foto?
 *
 * Los puntos viven en el MUNDO, no en la textura: por eso rotar la esfera no los
 * mueve y hay que moverlos a mano cuando cambia el nivel después de ponerlos. Un
 * punto en la dirección d con el nivel A marca el detalle de la foto que está en
 * `A⁻¹·d` de la esfera; con el nivel B ese mismo detalle queda en `B·A⁻¹·d`.
 */
export function corregirPunto(
  yaw: number,
  pitch: number,
  antes: Nivel | undefined,
  despues: Nivel | undefined,
): { yaw: number; pitch: number } {
  cuaternionDeNivel(antes, _antes).invert()
  cuaternionDeNivel(despues, _despues)
  const y = yaw * DEG
  const p = pitch * DEG
  _dir.set(Math.cos(p) * Math.sin(y), Math.sin(p), -Math.cos(p) * Math.cos(y))
  _dir.applyQuaternion(_antes).applyQuaternion(_despues)
  return {
    yaw: Math.atan2(_dir.x, -_dir.z) / DEG,
    pitch: Math.asin(clamp(_dir.y, -1, 1)) / DEG,
  }
}

/** ¿Hay algo que corregir? Un nivel en cero es lo mismo que ninguno. */
export function hayNivel(nivel: Nivel | undefined): nivel is Nivel {
  return !!nivel && (nivel.tiltX !== 0 || nivel.tiltZ !== 0)
}

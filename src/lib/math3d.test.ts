import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { shortestDelta } from './math'
import { vector3ToYawPitch, yawPitchToVector3 } from './math3d'

/**
 * Las proyecciones viven en math3d.ts y no en math.ts, para que los módulos
 * que solo quieren un ángulo no arrastren three (ver el encabezado de math.ts).
 * La prueba sigue a la función.
 */

describe('yawPitchToVector3 y vector3ToYawPitch son inversas', () => {
  /* Ida y vuelta sobre una malla de la esfera. Los polos quedan fuera a
     propósito: en el cenit exacto el yaw deja de existir —todas las
     direcciones son la misma— así que la vuelta devuelve 0 y compararlo con el
     yaw de partida no significa nada. La captura ya lo trata aparte. */
  it('devuelve el mismo (yaw, pitch) sobre toda la malla', () => {
    const v = new THREE.Vector3()
    for (let yaw = -180; yaw < 180; yaw += 7.5) {
      for (let pitch = -85; pitch <= 85; pitch += 5) {
        const { yaw: yaw2, pitch: pitch2 } = vector3ToYawPitch(
          yawPitchToVector3(yaw, pitch, 1, v),
        )
        expect(Math.abs(shortestDelta(yaw, yaw2))).toBeLessThan(1e-9)
        expect(Math.abs(pitch - pitch2)).toBeLessThan(1e-9)
      }
    }
  })

  /* El radio no debe filtrarse al ángulo: los hotspots se colocan sobre una
     esfera de radio 500 y el yaw tiene que salir igual que sobre una de 1. */
  it('no le importa el radio de la esfera', () => {
    const { yaw, pitch } = vector3ToYawPitch(yawPitchToVector3(37, -22, 500))
    expect(Math.abs(shortestDelta(37, yaw))).toBeLessThan(1e-9)
    expect(Math.abs(pitch + 22)).toBeLessThan(1e-9)
  })

  /* Los cuatro puntos cardinales, escritos a mano. Si alguien "simplifica" la
     fórmula y le cambia un signo, la ida y vuelta de arriba sigue pasando
     —porque el error se cancela consigo mismo— y esta prueba no. */
  it('coloca el frente en -Z y la derecha en +X', () => {
    const cerca = (v: THREE.Vector3, x: number, y: number, z: number) => {
      expect(Math.abs(v.x - x)).toBeLessThan(1e-9)
      expect(Math.abs(v.y - y)).toBeLessThan(1e-9)
      expect(Math.abs(v.z - z)).toBeLessThan(1e-9)
    }
    cerca(yawPitchToVector3(0, 0), 0, 0, -1)
    cerca(yawPitchToVector3(90, 0), 1, 0, 0)
    cerca(yawPitchToVector3(-90, 0), -1, 0, 0)
    cerca(yawPitchToVector3(0, 90), 0, 1, 0)
  })
})

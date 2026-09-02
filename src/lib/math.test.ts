import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { shortestDelta, vector3ToYawPitch, wrap180, wrap360, yawPitchToVector3 } from './math'

/**
 * ============================================================================
 *  LA GEOMETRÍA QUE NADIE VUELVE A REVISAR A MANO
 * ============================================================================
 *
 * Son cuatro funciones de diez líneas, y justamente por eso son peligrosas: un
 * signo al revés aquí no revienta nada, solo hace que el hotspot de la cocina
 * aparezca del lado contrario. Eso se descubre abriendo el recorrido en el
 * teléfono y girando hasta encontrarlo, o se descubre aquí en medio segundo.
 */

describe('wrap180', () => {
  /* El caso que se rompe solo: el borde. `((-180 % 360) + 360) % 360` da 180,
     y restarle 180 da 0... pero solo si se entra por el lado correcto. La
     función tiene un `if` dedicado a que -180 salga como +180 y no como -180,
     porque el rango prometido es (-180, 180] y hay código que compara contra
     él. */
  it('deja el borde en +180 y nunca en -180', () => {
    expect(wrap180(-180)).toBe(180)
    expect(wrap180(180)).toBe(180)
    expect(wrap180(540)).toBe(180)
    expect(wrap180(-540)).toBe(180)
  })

  it('devuelve siempre algo dentro de (-180, 180]', () => {
    for (let deg = -1080; deg <= 1080; deg += 7.5) {
      const a = wrap180(deg)
      expect(a).toBeGreaterThan(-180)
      expect(a).toBeLessThanOrEqual(180)
      // Y es el MISMO ángulo, no otro: la diferencia es un número entero de vueltas.
      expect(Math.abs(Math.round((deg - a) / 360) * 360 - (deg - a))).toBeLessThan(1e-9)
    }
  })
})

describe('wrap360', () => {
  it('normaliza a [0, 360)', () => {
    expect(wrap360(0)).toBe(0)
    expect(wrap360(360)).toBe(0)
    expect(wrap360(-90)).toBe(270)
    expect(wrap360(450)).toBe(90)
  })
})

describe('shortestDelta', () => {
  /* Sin esto, animar de 350° a 10° da la vuelta larga: 340° de recorrido en
     vez de 20°, y en pantalla se ve como un tirón hacia el lado equivocado. */
  it('toma el camino corto aunque cruce el 0', () => {
    expect(shortestDelta(350, 10)).toBe(20)
    expect(shortestDelta(10, 350)).toBe(-20)
    expect(shortestDelta(0, 0)).toBe(0)
  })
})

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

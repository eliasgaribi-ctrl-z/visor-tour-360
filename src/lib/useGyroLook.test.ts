import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { requestOrientationPermission } from './capture/orientation'
import { shortestDelta, wrap180 } from './math'
import { ZONA_MUERTA, desenvolver, hayQueAplicar, offsetHacia, offsetSinSalto } from './giro'

/**
 * ============================================================================
 *  LO QUE SÍ SE PUEDE PROBAR DEL GIROSCOPIO SIN UN IPHONE
 * ============================================================================
 *
 * Los sensores, el diálogo de permiso de Safari y una mano moviendo el
 * teléfono no caben en CI; eso lo mide `tools/pruebas/giroscopio.mjs` con
 * eventos sintéticos en un navegador. Lo que sí cabe —y es donde un signo al
 * revés se nota como "la habitación pega un latigazo al encender"— es la
 * aritmética del offset entre el cero arbitrario del giroscopio y la
 * habitación, que vive en `src/lib/giro.ts` justamente para poder probarla.
 */

const DEG = Math.PI / 180
const giroY = (grados: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), grados * DEG)

describe('offsetSinSalto', () => {
  /* La cámara mira a 40° y el teléfono se enciende apuntando a su cero
     arbitrario, digamos 300°. El objetivo del cuadro siguiente tiene que ser
     los mismos 40°: encender no mueve nada. */
  it('encender el sensor no mueve la cámara ni un grado', () => {
    for (const camara of [-170, -40, 0, 40, 179, 725]) {
      for (const sensor of [-179, -90, 0, 33.3, 179]) {
        const offset = offsetSinSalto(camara, sensor)
        expect(sensor + offset).toBeCloseTo(camara, 9)
      }
    }
  })
})

describe('desenvolver', () => {
  it('cruzar la costura es un paso chico, no una vuelta entera', () => {
    // 179 → -179 son 2° a la derecha, no 358° a la izquierda.
    expect(desenvolver(179, -179)).toBeCloseTo(181, 9)
    expect(desenvolver(-179, 179)).toBeCloseTo(-181, 9)
  })

  it('sigue al sensor aunque el acumulado lleve vueltas de más', () => {
    let acumulado = 0
    for (const lectura of [10, 90, 170, -170, -90, -10, 70, 150, -130, -50, 30]) {
      acumulado = desenvolver(acumulado, lectura)
      // El ángulo es el del sensor; solo cambia cuántas vueltas lleva encima.
      expect(Math.abs(shortestDelta(acumulado, lectura))).toBeLessThan(1e-9)
    }
    expect(acumulado).toBeGreaterThan(360) // dio más de una vuelta sin retroceder
  })
})

describe('offsetHacia', () => {
  it('deja la lectura del sensor apuntando exactamente al destino', () => {
    for (const sensor of [-170, -30, 0, 45, 179]) {
      for (const offset of [-400, -10, 0, 25, 720]) {
        for (const destino of [-180, -90, 0, 90, 179.5]) {
          const nuevo = offsetHacia(sensor, offset, destino)
          expect(Math.abs(wrap180(sensor + nuevo - destino))).toBeLessThan(1e-9)
        }
      }
    }
  })

  it('nunca corrige más de media vuelta', () => {
    for (const sensor of [-170, 0, 100]) {
      for (const destino of [-179, -1, 0, 1, 179]) {
        const nuevo = offsetHacia(sensor, 0, destino)
        expect(Math.abs(nuevo)).toBeLessThanOrEqual(180)
      }
    }
  })

  it('es idempotente: apuntar a donde ya se apunta no mueve nada', () => {
    const nuevo = offsetHacia(20, 50, 70)
    expect(offsetHacia(20, nuevo, 70)).toBeCloseTo(nuevo, 9)
  })
})

describe('hayQueAplicar (la zona muerta)', () => {
  it('la primera lectura siempre pasa: es la que fija el offset sin salto', () => {
    expect(hayQueAplicar(null, giroY(123))).toBe(true)
  })

  /* El ruido de un teléfono en la mesa: décimas de grado. Si esto pasara, el
     visor pediría cuadro sesenta veces por segundo con el teléfono quieto. */
  it('una lectura dentro de la zona muerta no se aplica', () => {
    expect(hayQueAplicar(giroY(0), giroY(ZONA_MUERTA * 0.6))).toBe(false)
    expect(hayQueAplicar(giroY(0), giroY(-ZONA_MUERTA * 0.6))).toBe(false)
  })

  it('una lectura fuera de la zona muerta sí', () => {
    expect(hayQueAplicar(giroY(0), giroY(ZONA_MUERTA * 1.5))).toBe(true)
    expect(hayQueAplicar(giroY(0), giroY(90))).toBe(true)
  })

  it('la zona es angular, no por eje: un cabeceo chico también se queda fuera', () => {
    const cabeceo = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ZONA_MUERTA * 0.6 * DEG)
    expect(hayQueAplicar(giroY(0), cabeceo)).toBe(false)
  })
})

describe('requestOrientationPermission', () => {
  afterEach(() => vi.unstubAllGlobals())

  /* `'prompt'` es "el diálogo se cerró sin decidir", no "dijo que no". Doblarlo
     a `'denied'` mandaba a la persona a Ajustes → Safari a arreglar algo que no
     está roto; lo único que hacía falta era volver a tocar. */
  it('distingue un diálogo sin decidir de un permiso negado', async () => {
    for (const respuesta of ['granted', 'prompt', 'denied'] as const) {
      vi.stubGlobal('DeviceOrientationEvent', { requestPermission: async () => respuesta })
      expect(await requestOrientationPermission()).toBe(respuesta)
    }
  })

  it('sin diálogo, o con Safari negándose a abrirlo, no inventa un permiso', async () => {
    vi.stubGlobal('DeviceOrientationEvent', {})
    expect(await requestOrientationPermission()).toBe('unsupported')

    vi.stubGlobal('DeviceOrientationEvent', {
      requestPermission: async () => {
        throw new Error('no user gesture')
      },
    })
    expect(await requestOrientationPermission()).toBe('denied')
  })
})

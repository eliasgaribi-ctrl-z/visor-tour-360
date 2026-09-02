import { describe, expect, it } from 'vitest'
import { shortestDelta, wrap180, wrap360 } from './math'

/**
 * ============================================================================
 *  LA GEOMETRÍA QUE NADIE VUELVE A REVISAR A MANO
 * ============================================================================
 *
 * Son tres funciones de diez líneas (las proyecciones van en math3d.test.ts), y justamente por eso son peligrosas: un
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

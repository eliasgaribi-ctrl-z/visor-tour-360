import { describe, expect, it } from 'vitest'

import {
  anguloDelCono,
  caminoDelCono,
  giroHeredado,
  limpiarPlano,
  limpiarPosicion,
  posicionEnPlano,
  referenciaDeGiro,
} from './planta'

/**
 * ============================================================================
 *  EL PLANO DE LA CASA
 * ============================================================================
 *
 * Como en `rumbo.mjs`, los casos se escriben como escenarios físicos y la
 * respuesta sale de la geometría, no de la fórmula: un signo al revés en el
 * cono se ve como "el cono apunta raro" y nadie lo reporta.
 */

describe('anguloDelCono', () => {
  it('con la camara al frente, el cono apunta a donde mira la foto en el plano', () => {
    // La foto de la sala se tomó mirando hacia la derecha del plano (90°).
    expect(anguloDelCono(0, 90)).toBe(90)
  })

  it('girar la camara a la DERECHA gira el cono en el sentido del reloj', () => {
    /* Yaw positivo es girar a la derecha en todo el proyecto; visto desde
       arriba —que es lo que es un plano— eso es el sentido del reloj, y
       `rotate()` en pantalla también. */
    expect(anguloDelCono(30, 90)).toBe(120)
    expect(anguloDelCono(-30, 90)).toBe(60)
  })

  it('da la vuelta al circulo sin salirse de [0, 360)', () => {
    expect(anguloDelCono(300, 90)).toBe(30)
    expect(anguloDelCono(-100, 0)).toBe(260)
  })
})

describe('giroHeredado', () => {
  const sala = { rumbo: 70, giro: 90 }

  it('dos cuartos capturados se orientan entre si por la diferencia de rumbos', () => {
    /* La sala mira al rumbo 70 y en el plano su frente apunta a 90°. Un cuarto
       que mira al rumbo 160 mira 90° más a la derecha en el mundo, así que
       también 90° más a la derecha en el plano: 180°. */
    expect(giroHeredado(160, sala)).toBe(180)
  })

  it('el mismo rumbo es el mismo giro', () => {
    expect(giroHeredado(70, sala)).toBe(90)
  })

  it('y cruza el cero del circulo', () => {
    expect(giroHeredado(350, sala)).toBe(10)
    expect(giroHeredado(10, { rumbo: 350, giro: 0 })).toBe(20)
  })
})

describe('referenciaDeGiro', () => {
  it('toma la primera habitacion que sabe hacia donde mira en el plano Y en el mundo', () => {
    const escenas = [
      { id: 'a', rumbo: 70 }, // capturada pero sin colocar: no sirve
      { id: 'b', plano: { x: 0.5, y: 0.5, giro: 40 } }, // importada, sin rumbo: no sirve
      { id: 'c', rumbo: 120, plano: { x: 0.2, y: 0.4, giro: 200 } },
    ]
    expect(referenciaDeGiro(escenas)).toEqual({ rumbo: 120, giro: 200 })
    // La propia habitación no puede ser su referencia.
    expect(referenciaDeGiro(escenas, 'c')).toBeNull()
  })
})

describe('posicionEnPlano', () => {
  const caja = { left: 20, top: 100, width: 300, height: 200 }

  it('convierte el dedo a la fraccion de la imagen', () => {
    expect(posicionEnPlano(20 + 150, 100 + 50, caja)).toEqual({ x: 0.5, y: 0.25 })
  })

  it('un dedo fuera de la imagen se queda en la orilla', () => {
    expect(posicionEnPlano(-500, 5000, caja)).toEqual({ x: 0, y: 1 })
  })

  it('una caja sin tamano no divide entre cero', () => {
    expect(posicionEnPlano(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0.5, y: 0.5 })
  })
})

describe('caminoDelCono', () => {
  it('es un sector simetrico que apunta hacia arriba', () => {
    const d = caminoDelCono(90, 40)
    // Con 90° de apertura las orillas quedan a ±45°: (±28.28, −28.28).
    expect(d).toBe('M0 0 L-28.28 -28.28 A40 40 0 0 1 28.28 -28.28 Z')
  })

  it('acota un fov absurdo para que el cono siga siendo un cono', () => {
    expect(caminoDelCono(0, 40)).toBe(caminoDelCono(10, 40))
    expect(caminoDelCono(359, 40)).toBe(caminoDelCono(170, 40))
  })
})

describe('limpiarPosicion', () => {
  it('acota a la imagen y lleva el giro al circulo', () => {
    expect(limpiarPosicion({ x: 1.7, y: -2, giro: 400 })).toEqual({ x: 1, y: 0, giro: 40 })
    expect(limpiarPosicion({ x: '0.25', y: '0.5' })).toEqual({ x: 0.25, y: 0.5 })
  })

  it('sin x o sin y no hay posicion, y sin giro no se inventa uno', () => {
    expect(limpiarPosicion({ x: 0.5 })).toBeUndefined()
    expect(limpiarPosicion({ x: 'medio', y: 0.5 })).toBeUndefined()
    expect(limpiarPosicion(null)).toBeUndefined()
    expect(limpiarPosicion({ x: 0.5, y: 0.5 })?.giro).toBeUndefined()
  })
})

describe('limpiarPlano', () => {
  it('acepta un plano con archivo y tamano entero', () => {
    expect(limpiarPlano({ archivo: 'plano/plano.jpg', ancho: 1600.4, alto: '900' })).toEqual({
      archivo: 'plano/plano.jpg',
      ancho: 1600,
      alto: 900,
    })
  })

  it('rechaza lo que no puede ser una imagen', () => {
    expect(limpiarPlano({ archivo: '', ancho: 10, alto: 10 })).toBeUndefined()
    expect(limpiarPlano({ archivo: 'plano.jpg', ancho: 0, alto: 10 })).toBeUndefined()
    expect(limpiarPlano({ archivo: 'plano.jpg', ancho: 99999, alto: 10 })).toBeUndefined()
    expect(limpiarPlano({ archivo: 'plano.jpg', ancho: 10 })).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'

import { anglesOf, deviceQuaternion } from './capture/orientation'
import { shortestDelta, wrap180 } from './math'
import { desfaseHacia, desfaseInicial, miradaDelSensor } from './useGyroLook'

/**
 * ============================================================================
 *  LO QUE SÍ SE PUEDE PROBAR DEL GIROSCOPIO SIN UN IPHONE
 * ============================================================================
 *
 * Casi nada de esta función se puede verificar en CI: no hay sensores, no hay
 * diálogo de permiso de Safari y no hay una mano moviendo el teléfono. Lo que
 * sí es comprobable —y es justo donde un signo al revés se nota como "la
 * habitación pega un latigazo al encender"— es la aritmética del desfase entre
 * el cero arbitrario del giroscopio y la habitación.
 *
 * Son tres propiedades, y las tres son de las que no se descubren mirando el
 * código: que encender no mueva nada, que saltar de cuarto tome el camino
 * corto, y que el ladeo del teléfono no se cuele en la mirada.
 */

describe('desfaseInicial', () => {
  /* La propiedad que importa: en el instante de encender, la cámara se queda
     donde estaba. Con el yaw del rig SIN normalizar, que es como vive de
     verdad —crece sin límite y puede valer 3000° después de dar ocho vueltas
     con el joystick— porque es ahí donde una resta ingenua se rompe. */
  it('encender el sensor no mueve la cámara ni un grado', () => {
    for (const yawCamara of [0, 37.5, -180, 359.9, 3000, -2471.25]) {
      for (const yawSensor of [0, 90, -179.9, 180, 12.34]) {
        const desfase = desfaseInicial(yawCamara, yawSensor)
        expect(shortestDelta(yawCamara, yawSensor + desfase)).toBeCloseTo(0, 9)
      }
    }
  })
})

describe('desfaseHacia', () => {
  /* Cambiar de habitación con el sensor encendido no puede girar la cámara: el
     teléfono está donde está. Lo que se mueve es la habitación debajo. Después
     de recalcular el desfase, la lectura del sensor tiene que caer justo sobre
     el frente del cuarto nuevo. */
  it('deja la lectura del sensor apuntando exactamente al destino', () => {
    for (const yawSensor of [0, 45, -120, 179.9]) {
      for (const desfase of [0, -33, 720, -540.5]) {
        for (const destino of [0, 168, -90, 359]) {
          const nuevo = desfaseHacia(yawSensor, desfase, destino)
          expect(shortestDelta(yawSensor + nuevo, destino)).toBeCloseTo(0, 9)
        }
      }
    }
  })

  /* Y lo hace por el camino corto. Sin el `shortestDelta` de adentro, un
     destino a −179° se resolvería girando 181° en la dirección contraria: el
     desfase no se ve, pero se ve la habitación dando una vuelta de más. */
  it('nunca corrige más de media vuelta', () => {
    for (let yawSensor = -180; yawSensor <= 180; yawSensor += 7.5) {
      for (let destino = -720; destino <= 720; destino += 17.5) {
        const movimiento = desfaseHacia(yawSensor, 0, destino) - 0
        expect(Math.abs(movimiento)).toBeLessThanOrEqual(180 + 1e-9)
      }
    }
  })

  /* Aplicarlo dos veces seguidas con el mismo destino no debe mover nada la
     segunda vez. Es la salvaguarda contra un `goto` que llegue repetido
     (cambiar de cuarto y reencuadrar en el mismo cuadro). */
  it('es idempotente', () => {
    const uno = desfaseHacia(37, 0, 168)
    const dos = desfaseHacia(37, uno, 168)
    expect(dos).toBeCloseTo(uno, 9)
  })
})

describe('miradaDelSensor', () => {
  /* Las direcciones de referencia, las mismas que verifica orientation.ts,
     pero ya pasadas por el filtro de dos ejes que usa el visor. */
  it('mantiene las direcciones conocidas', () => {
    // Teléfono vertical apuntando al norte: al frente y sin inclinación.
    const alFrente = miradaDelSensor(deviceQuaternion(0, 90, 0, 0))
    expect(alFrente.yaw).toBeCloseTo(0, 6)
    expect(alFrente.pitch).toBeCloseTo(0, 6)

    // Inclinado 45° hacia atrás: mira 45° hacia arriba.
    const arriba = miradaDelSensor(deviceQuaternion(0, 135, 0, 0))
    expect(arriba.pitch).toBeCloseTo(45, 6)

    // Plano sobre la mesa: mira al piso.
    const alPiso = miradaDelSensor(deviceQuaternion(0, 0, 0, 0))
    expect(alPiso.pitch).toBeCloseTo(-90, 6)
  })

  /**
   * Modo YAWPITCH: el ladeo se tira, y tirarlo no le quita nada a la dirección.
   *
   * Es la prueba que justifica la decisión. Se barren orientaciones de
   * teléfono variadas y se comprueba que la mirada de dos ejes es exactamente
   * la que da `anglesOf` en yaw y pitch: lo que se pierde al ignorar el roll
   * es SOLO el roll, o sea la inclinación del horizonte, y nunca hacia dónde
   * se está mirando. Si alguien un día "arregla" esto aplicando el ladeo, la
   * habitación se va a inclinar cada vez que la persona ladee la muñeca.
   */
  it('tira el ladeo y no se lleva nada más', () => {
    let huboRollGrande = false

    for (let alpha = 0; alpha < 360; alpha += 45) {
      for (const beta of [10, 55, 90, 130, 170]) {
        for (const gamma of [-70, -25, 0, 25, 70]) {
          for (const pantalla of [0, 90, 180, 270]) {
            const q = deviceQuaternion(alpha, beta, gamma, pantalla)
            const completo = anglesOf(q)
            const mirada = miradaDelSensor(q)

            expect(mirada.yaw).toBeCloseTo(completo.yaw, 9)
            expect(mirada.pitch).toBeCloseTo(completo.pitch, 9)
            // Y no trae un tercer ángulo que alguien pudiera aplicar por error.
            expect(Object.keys(mirada).sort()).toEqual(['pitch', 'yaw'])

            if (Math.abs(wrap180(completo.roll)) > 30) huboRollGrande = true
          }
        }
      }
    }

    // Si el barrido no incluyera ni un teléfono bien ladeado, la prueba de
    // arriba no estaría probando nada.
    expect(huboRollGrande).toBe(true)
  })
})

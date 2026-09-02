import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  OrientationTracker,
  SIN_LECTURA,
  anglesOf,
  deviceQuaternion,
  requestOrientationPermission,
} from './capture/orientation'
import { shortestDelta, wrap180 } from './math'
import {
  anclarSesionGiro,
  desfaseHacia,
  desfaseInicial,
  hayLecturaNueva,
  miradaDelSensor,
} from './useGyroLook'

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

/* ============================================================================
 *  EL PRIMER CUADRO: LO QUE LAS PRUEBAS DE ARRIBA NO VEÍAN
 * ==========================================================================
 *
 * Las tres pruebas anteriores comprueban la aritmética del desfase, y la
 * aritmética siempre estuvo bien. Lo que se rompía era CONTRA QUÉ se aplicaba:
 * el visor anclaba la habitación contra una lectura que no existía (el objeto
 * del seguidor recién construido, con sus ceros) o contra una caducada (la de
 * antes de irse a segundo plano). Con el desfase perfecto y el ancla inventada,
 * la habitación pega el mismo latigazo de media vuelta que todo el mecanismo
 * existe para evitar.
 *
 * Así que estas pruebas no miran funciones sueltas: montan el seguidor DE
 * VERDAD contra un navegador de mentiras, y le dan cuerda cuadro por cuadro
 * como hace el visor. Un `window` con cuatro métodos es todo lo que
 * `OrientationTracker` toca, y eso sí cabe en CI.
 */

/** Lo que registra el seguidor con `addEventListener`. */
type Escucha = (evento: DeviceOrientationEvent) => void

/**
 * Un navegador del tamaño justo: lo que `OrientationTracker` necesita para
 * escuchar, y un mando para que el teléfono "gire".
 */
function montarNavegador() {
  const escuchas = new Map<string, Set<Escucha>>()

  vi.stubGlobal('window', {
    addEventListener: (tipo: string, fn: Escucha) => {
      const grupo = escuchas.get(tipo) ?? new Set<Escucha>()
      grupo.add(fn)
      escuchas.set(tipo, grupo)
    },
    removeEventListener: (tipo: string, fn: Escucha) => {
      escuchas.get(tipo)?.delete(fn)
    },
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
    innerWidth: 390,
    innerHeight: 844,
  })
  // Vertical: es la única postura en la que el seguidor muestrea el norte.
  vi.stubGlobal('screen', { orientation: { angle: 0 } })
  // Definido pero sin `requestPermission`: un Android, no un iPhone.
  vi.stubGlobal('DeviceOrientationEvent', {})

  return {
    /** El teléfono, vertical en la mano, apuntando a `alpha` grados. */
    girar(alpha: number) {
      const evento = { alpha, beta: 90, gamma: 0 } as DeviceOrientationEvent
      for (const fn of escuchas.get('deviceorientation') ?? []) fn(evento)
    },
    /** Cuántos escuchas quedan colgados. Debe volver a 0 tras `stop()`. */
    get enganchados() {
      let total = 0
      for (const grupo of escuchas.values()) total += grupo.size
      return total
    },
  }
}

/** El estado que el CameraRig lleva entre cuadros mientras el sensor manda. */
type Camara = { yaw: number; targetYaw: number; desfase: number }

/**
 * El bloque de giroscopio del CameraRig, en tres líneas.
 *
 * Es un espejo a mano de src/components/tour/CameraRig.tsx —el ancla de la
 * sesión nueva, el objetivo por el camino corto y el `yaw = targetYaw` sin
 * `damp`, que es lo que hace el rig con el sensor al mando—. Lo que no se
 * copia es el arrastre ni el joystick: en cuanto cualquiera de los dos se
 * mueve, el rig apaga el sensor y este camino deja de existir.
 */
function cuadroDelRig(camara: Camara, sensor: { yaw: number }, sesionNueva: boolean) {
  if (sesionNueva) camara.desfase = anclarSesionGiro(camara, sensor.yaw)
  camara.targetYaw += shortestDelta(camara.targetYaw, sensor.yaw + camara.desfase)
  camara.yaw = camara.targetYaw
}

/**
 * El bucle de `useGyroLook`, con la misma guarda y el mismo orden.
 *
 * `cuadros(n)` es el requestAnimationFrame corriendo n veces sin que
 * necesariamente haya pasado nada, que es justo la situación que destapa el
 * fallo: el rAF arranca de inmediato y el primer evento del sensor puede
 * tardar, o no llegar nunca.
 */
function conectarVisor(seguidor: OrientationTracker, camara: Camara) {
  let ultima = SIN_LECTURA
  let sesion = 0
  let sesionVistaPorElRig = -1
  let publicaciones = 0

  return {
    get publicaciones() {
      return publicaciones
    },
    /** Lo que hace `arrancarSesion`: objeto nuevo para el rig y a contar de cero. */
    sesionNueva() {
      ultima = SIN_LECTURA
      sesion += 1
    },
    cuadros(cuantos: number) {
      for (let i = 0; i < cuantos; i += 1) {
        const lectura = seguidor.reading
        if (!hayLecturaNueva(lectura.updatedAt, ultima)) continue
        ultima = lectura.updatedAt
        publicaciones += 1
        cuadroDelRig(camara, miradaDelSensor(lectura.suave), sesion !== sesionVistaPorElRig)
        sesionVistaPorElRig = sesion
      }
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('el primer cuadro de una sesión del sensor', () => {
  /* El fallo, tal cual: el rAF gana la carrera al primer `deviceorientation`
     —siempre, en la emulación de DevTools— y el visor publica los ceros del
     objeto recién construido. El rig los toma por una dirección de verdad,
     ancla ahí, y cuando entra la lectura buena la habitación gira lo que valga
     esa lectura: con el teléfono al sur, media vuelta en un cuadro. */
  it('no publica nada mientras no haya llegado un evento de verdad', () => {
    const navegador = montarNavegador()
    const seguidor = new OrientationTracker()
    const camara: Camara = { yaw: 137, targetYaw: 137, desfase: 0 }
    const visor = conectarVisor(seguidor, camara)

    seguidor.start()
    visor.cuadros(12)

    expect(visor.publicaciones).toBe(0)
    expect(camara.yaw).toBe(137)

    // Llega la primera lectura de verdad, con el teléfono mirando al sur.
    navegador.girar(180)
    visor.cuadros(1)

    expect(visor.publicaciones).toBe(1)
    // Y la cámara sigue exactamente donde la persona la había dejado.
    expect(shortestDelta(137, camara.yaw)).toBeCloseTo(0, 9)

    seguidor.stop()
    expect(navegador.enganchados).toBe(0)
  })

  /* Con el sensor ya encendido, un cuadro sin evento nuevo no toca nada: es lo
     que deja dormirse al canvas en `frameloop="demand"`. */
  it('publica una vez por lectura y no una vez por cuadro', () => {
    const navegador = montarNavegador()
    const seguidor = new OrientationTracker()
    const camara: Camara = { yaw: 0, targetYaw: 0, desfase: 0 }
    const visor = conectarVisor(seguidor, camara)

    seguidor.start()
    navegador.girar(30)
    visor.cuadros(20)

    expect(visor.publicaciones).toBe(1)
    seguidor.stop()
  })

  /* A4: en un portátil táctil o una tablet sin giroscopio, `puedeHaberSensores`
     apuesta que sí y el evento nunca dispara. Antes eso clavaba la vista en el
     horizonte los dos segundos que tarda el seguidor en rendirse, porque el
     pitch publicado era 0 y el rig se salta el suavizado. Ahora no se publica
     nada, así que esos dos segundos no se ven: el visor sigue con joystick y
     arrastre hasta que el botón desaparece solo. */
  it('en un aparato sin sensores no mueve la cámara en los dos segundos de espera', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const navegador = montarNavegador()
    const seguidor = new OrientationTracker()
    const camara: Camara = { yaw: 42.5, targetYaw: 42.5, desfase: 0 }
    const visor = conectarVisor(seguidor, camara)

    expect(seguidor.start()).toBe('esperando')
    visor.cuadros(120) // dos segundos a 60 cuadros por segundo

    expect(visor.publicaciones).toBe(0)
    expect(camara.yaw).toBe(42.5)
    expect(camara.targetYaw).toBe(42.5)

    vi.advanceTimersByTime(2000)
    expect(seguidor.state).toBe('no-soportado')
    expect(navegador.enganchados).toBeGreaterThan(0) // sigue enganchado hasta el stop

    seguidor.stop()
  })

  /* A2: la pantalla se bloquea, el sensor se suelta para no gastar pila, y la
     persona camina a otro cuarto con el teléfono en el bolsillo. Al volver, la
     lectura que quedó guardada es de hace media hora; anclar contra ella hace
     que la habitación gire exactamente lo que giró el teléfono mientras estaba
     oculta, que es justo el fallo que este bloque dice evitar. */
  it('volver de segundo plano no ancla contra la lectura vieja', () => {
    const navegador = montarNavegador()
    const seguidor = new OrientationTracker()
    const camara: Camara = { yaw: 137, targetYaw: 137, desfase: 0 }
    const visor = conectarVisor(seguidor, camara)

    seguidor.start()
    navegador.girar(0)
    visor.cuadros(1)
    const yawAntesDeOcultar = camara.yaw

    // La pestaña se oculta: `pararSesion` → `stop()`.
    seguidor.stop()
    expect(seguidor.reading.updatedAt).toBe(SIN_LECTURA)

    // Vuelve a primer plano media hora y 180° después.
    seguidor.start()
    visor.sesionNueva()
    const publicadasAntes = visor.publicaciones
    visor.cuadros(10)
    expect(visor.publicaciones).toBe(publicadasAntes)
    expect(camara.yaw).toBe(yawAntesDeOcultar)

    // Y la primera lectura de la sesión nueva tampoco mueve la habitación.
    navegador.girar(180)
    visor.cuadros(1)
    expect(visor.publicaciones).toBe(publicadasAntes + 1)
    expect(shortestDelta(yawAntesDeOcultar, camara.yaw)).toBeCloseTo(0, 9)

    seguidor.stop()
  })
})

describe('anclarSesionGiro', () => {
  /* A3: la secuencia natural —tocar un enlace de habitación y encender el
     giroscopio mientras el paneo todavía corre— con los dos extremos separados
     media vuelta, que es el peor caso. La cámara tiene que quedarse en lo que
     se está dibujando; anclando contra el objetivo se teletransporta al destino
     pendiente de un solo cuadro, porque con el sensor al mando no hay `damp`. */
  it('ancla contra lo que se ve y no contra el destino de la animación', () => {
    const navegador = montarNavegador()
    const seguidor = new OrientationTracker()
    const camara: Camara = { yaw: 137, targetYaw: 317, desfase: 0 }
    const visor = conectarVisor(seguidor, camara)

    seguidor.start()
    navegador.girar(75)
    visor.cuadros(1)

    expect(shortestDelta(137, camara.yaw)).toBeCloseTo(0, 9)
    expect(Math.abs(shortestDelta(317, camara.yaw))).toBeCloseTo(180, 6)

    seguidor.stop()
  })

  /* Y la misma propiedad barrida, sin navegador de por medio: el desfase
     siempre deja la lectura del sensor encima de lo que se está dibujando, con
     el yaw del rig sin normalizar (crece sin límite) y el del sensor
     en (−180, 180]. */
  it('deja el sensor encima del yaw dibujado, esté donde esté el objetivo', () => {
    for (const yawVisible of [0, 137, -42.5, 3000, -2471.25]) {
      for (const yawObjetivo of [yawVisible, yawVisible + 180, yawVisible - 179.9, 0]) {
        for (const yawSensor of [0, 90, -179.9, 12.34]) {
          const desfase = anclarSesionGiro({ yaw: yawVisible, targetYaw: yawObjetivo }, yawSensor)
          expect(shortestDelta(yawVisible, yawSensor + desfase)).toBeCloseTo(0, 9)
        }
      }
    }
  })
})

describe('hayLecturaNueva', () => {
  it('no da por buena la lectura de un seguidor recién construido', () => {
    montarNavegador()
    const seguidor = new OrientationTracker()
    expect(seguidor.reading.updatedAt).toBe(SIN_LECTURA)
    expect(hayLecturaNueva(seguidor.reading.updatedAt, SIN_LECTURA)).toBe(false)
  })

  it('deja pasar cada marca de tiempo una sola vez', () => {
    expect(hayLecturaNueva(1234.5, SIN_LECTURA)).toBe(true)
    expect(hayLecturaNueva(1234.5, 1234.5)).toBe(false)
    expect(hayLecturaNueva(1235.5, 1234.5)).toBe(true)
  })

  /* Y la lectura vacía no pasa CON NINGÚN centinela detrás. Es la mitad de la
     guarda que se rompió: la versión anterior llevaba la cuenta arrancando
     en −1, y como el seguidor recién construido trae `updatedAt` en 0, la
     comparación decía "es distinta, o sea que es nueva" y publicaba una
     dirección que nunca existió. */
  it('nunca da por buena la lectura vacía, sea cual sea el centinela', () => {
    for (const yaPublicado of [-1, SIN_LECTURA, 1234.5]) {
      expect(hayLecturaNueva(SIN_LECTURA, yaPublicado)).toBe(false)
    }
  })
})

describe('requestOrientationPermission', () => {
  /* A5: `'prompt'` es "el diálogo se cerró sin decidir", no "dijo que no".
     Doblarlo a `'denied'` mandaba a la persona a Ajustes → Safari a arreglar
     algo que no está roto; lo único que hacía falta era volver a tocar. */
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

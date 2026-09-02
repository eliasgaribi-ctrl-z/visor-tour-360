import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { DEG, wrap180 } from '../math'
import { medirDeriva, type TomaMedible } from './anillo'
import { anglesOf } from './orientation'

/**
 * ============================================================================
 *  PRUEBA DEL CIERRE DEL ANILLO
 * ============================================================================
 *
 * Aquí se puede probar de verdad lo que en un teléfono solo se puede mirar de
 * lejos: se fabrica un cuarto conocido, se le toman fotos conocidas, se le
 * inyecta al giroscopio una deriva conocida, y se comprueba que la medición la
 * recupera. Si el signo estuviera al revés, o si la vuelta se recorriera al
 * revés, estas pruebas se caen.
 *
 * El cuarto es ruido de valor de cuatro octavas: no se parece a una sala, pero
 * tiene detalle en todas las escalas y en todas las direcciones, que es lo
 * único que la correlación necesita. Una foto real tiene MENOS detalle que
 * esto en las paredes lisas y más en los muebles.
 *
 * La cámara simulada es un teléfono en VERTICAL, que es como se sostiene:
 * 52° de campo horizontal y 66° vertical, los mismos números que salen de
 * `fovDe()` para un fotograma de 1200×1600 con un lente de 66° en el lado
 * largo. Es a propósito el caso difícil: en vertical el campo horizontal es
 * chico y las tomas del plan quedan a 30° una de otra.
 */

const HFOV = 51.9
const VFOV = 66
const GRIS = { ancho: 96, alto: 72 }

/* ------------------------------------------------------- EL CUARTO DE MENTIRA */

const EQUI = { ancho: 2048, alto: 1024 }
const mundo = new Float32Array(EQUI.ancho * EQUI.alto)

function revoltijo(x: number, y: number, semilla: number): number {
  let h = x * 374761393 + y * 668265263 + semilla * 1274126177
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/** Una octava de ruido de valor: retícula de números al azar, interpolada suave. */
function octava(u: number, v: number, celdas: number, semilla: number): number {
  const x = u * celdas
  const y = v * (celdas / 2)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  // En horizontal la retícula da la vuelta: el cuarto tiene que cerrar.
  const dato = (a: number, b: number) => revoltijo(((a % celdas) + celdas) % celdas, b, semilla)
  const a = dato(x0, y0)
  const b = dato(x0 + 1, y0)
  const c = dato(x0, y0 + 1)
  const d = dato(x0 + 1, y0 + 1)
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy
}

for (let fila = 0; fila < EQUI.alto; fila++) {
  for (let columna = 0; columna < EQUI.ancho; columna++) {
    const u = (columna + 0.5) / EQUI.ancho
    const v = (fila + 0.5) / EQUI.alto
    mundo[fila * EQUI.ancho + columna] =
      0.5 * octava(u, v, 16, 1) +
      0.25 * octava(u, v, 48, 2) +
      0.15 * octava(u, v, 128, 3) +
      0.1 * octava(u, v, 320, 4)
  }
}

function mirarAlMundo(yaw: number, pitch: number): number {
  let u = yaw / 360 + 0.5
  u -= Math.floor(u)
  const v = Math.min(0.9999, Math.max(0, (90 - pitch) / 180))
  return mundo[Math.min(EQUI.alto - 1, Math.floor(v * EQUI.alto)) * EQUI.ancho +
    Math.min(EQUI.ancho - 1, Math.floor(u * EQUI.ancho))]
}

/* ------------------------------------------------------- LA CÁMARA DE MENTIRA */

function orientacionDe(yaw: number, pitch = 0, roll = 0): THREE.Quaternion {
  // La misma convención que usa la pantalla de captura y el CameraRig.
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pitch * DEG, -yaw * DEG, roll * DEG, 'YXZ'),
  )
}

/**
 * La miniatura en gris que habría dejado una foto tomada apuntando ahí.
 *
 * Con supermuestreo de 3×3: un píxel de la miniatura abarca medio grado y el
 * cuarto tiene detalle mucho más fino, así que sin promediar entraría un
 * hormigueo que no existe en una foto de verdad (la lente y el sensor ya
 * promedian).
 */
function fotografiar(orientacion: THREE.Quaternion): Float32Array {
  const tanH = Math.tan((HFOV * DEG) / 2)
  const tanV = Math.tan((VFOV * DEG) / 2)
  const salida = new Float32Array(GRIS.ancho * GRIS.alto)
  const direccion = new THREE.Vector3()

  for (let fila = 0; fila < GRIS.alto; fila++) {
    for (let columna = 0; columna < GRIS.ancho; columna++) {
      let suma = 0
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const px = ((columna + (sx + 0.5) / 3) / GRIS.ancho) * 2 - 1
          const py = 1 - ((fila + (sy + 0.5) / 3) / GRIS.alto) * 2
          direccion.set(px * tanH, py * tanV, -1).normalize().applyQuaternion(orientacion)
          suma += mirarAlMundo(
            Math.atan2(direccion.x, -direccion.z) / DEG,
            Math.asin(Math.max(-1, Math.min(1, direccion.y))) / DEG,
          )
        }
      }
      salida[fila * GRIS.ancho + columna] = suma / 9
    }
  }
  return salida
}

/**
 * Una vuelta completa del horizonte con deriva inyectada.
 *
 * La FOTO se toma hacia donde la cámara apuntó de verdad; la ORIENTACIÓN que se
 * guarda es la que reportó el giroscopio, que se va corriendo. Esa es
 * exactamente la mentira que el archivo tiene que descubrir.
 *
 * @param deriva  grados que el sensor reporta de más al terminar la vuelta.
 */
function vueltaConDeriva(deriva: number, tomas = 12, pitch = 0): TomaMedible[] {
  const salida: TomaMedible[] = []
  for (let i = 0; i < tomas; i++) {
    const yawReal = (360 / tomas) * i
    const error = (deriva * i) / (tomas - 1)
    salida.push({
      orientacion: orientacionDe(yawReal + error, pitch),
      grises: fotografiar(orientacionDe(yawReal, pitch)),
    })
  }
  return salida
}

const opciones = (tomas: TomaMedible[]) => ({
  tomas,
  ancho: GRIS.ancho,
  alto: GRIS.alto,
  hfov: HFOV,
  vfov: VFOV,
})

/* ------------------------------------------------------------------ ESPEJO */

/** El mismo fotograma volteado de izquierda a derecha. */
function espejar(grises: Float32Array): Float32Array {
  const salida = new Float32Array(grises.length)
  for (let fila = 0; fila < GRIS.alto; fila++) {
    for (let columna = 0; columna < GRIS.ancho; columna++) {
      salida[fila * GRIS.ancho + columna] =
        grises[fila * GRIS.ancho + (GRIS.ancho - 1 - columna)]
    }
  }
  return salida
}

/**
 * Una vuelta degenerada: todas las tomas apuntan al MISMO yaw.
 *
 * No es una captura de verdad y no pretende serlo. Sirve para anular el término
 * del salto entre tomas y dejar sola la parte del error del sensor, que es la
 * única forma de comprobar por separado las dos mitades de lo que hace el
 * espejo (ver la prueba que la usa).
 */
function vueltaSinSalto(deriva: number, tomas = 12): TomaMedible[] {
  const salida: TomaMedible[] = []
  const foto = fotografiar(orientacionDe(0))
  for (let i = 0; i < tomas; i++) {
    salida.push({ orientacion: orientacionDe((deriva * i) / (tomas - 1)), grises: foto })
  }
  return salida
}

/* ============================================================================ */

describe('medirDeriva', () => {
  it('recupera una deriva de 6° repartida en la vuelta, con menos de 1° de error', () => {
    const medicion = medirDeriva(opciones(vueltaConDeriva(6)))

    expect(medicion.deriva, medicion.motivo).not.toBeNull()
    expect(medicion.medidos).toBe(medicion.pares)
    expect(Math.abs(medicion.deriva!.grados - 6)).toBeLessThan(1)
    // Las dos mediciones independientes tienen que contar lo mismo.
    expect(Math.abs(medicion.porCadena! - medicion.porCierre!)).toBeLessThan(1)
  })

  it('el signo es el correcto: cada toma se corrige lo que se le sumó de más', () => {
    const deriva = 6
    const tomas = 12
    const medicion = medirDeriva(opciones(vueltaConDeriva(deriva, tomas)))
    expect(medicion.deriva, medicion.motivo).not.toBeNull()

    for (let i = 0; i < tomas; i++) {
      const errorInyectado = (deriva * i) / (tomas - 1)
      /* La corrección es lo que hay que sumarle al giro de base, que es justo
         lo que el sensor reportó de más. Si el signo estuviera al revés, aquí
         saldría el error cambiado de signo en vez de cero. */
      expect(Math.abs(medicion.deriva!.correcciones[i] - errorInyectado)).toBeLessThan(1)
    }
  })

  it('la primera toma no se mueve: es la que fija el frente de la panorámica', () => {
    const medicion = medirDeriva(opciones(vueltaConDeriva(6)))
    expect(medicion.deriva!.correcciones[0]).toBe(0)
  })

  it('una toma temprana que apunta un poco atrás NO se lleva la corrección entera', () => {
    /* El disparador acepta hasta 11° de desvío, así que la segunda toma puede
       acabar con un yaw MENOR que el de la primera. Ordenando la vuelta por yaw
       se iría al final de la fila y cargaría con los 6° enteros; ordenándola por
       orden de disparo, que es como se hace, le toca lo suyo. */
    const tomas = vueltaConDeriva(6)
    tomas[1] = {
      orientacion: orientacionDe(-4),
      grises: fotografiar(orientacionDe(-4 - 6 / 11)),
    }
    const medicion = medirDeriva(opciones(tomas))
    expect(medicion.deriva, medicion.motivo).not.toBeNull()
    expect(medicion.deriva!.correcciones[1]).toBeLessThan(1.5)
  })

  it('las tomas de arriba heredan la corrección de la del horizonte más cercana en yaw', () => {
    const tomas = vueltaConDeriva(6)
    // Una toma del anillo de arriba, mirando al mismo yaw que la número 6.
    const yawArriba = (360 / 12) * 6
    tomas.push({
      orientacion: orientacionDe(yawArriba, 40),
      grises: fotografiar(orientacionDe(yawArriba, 40)),
    })
    const medicion = medirDeriva(opciones(tomas))
    expect(medicion.deriva, medicion.motivo).not.toBeNull()
    // No entra al anillo (40° de pitch se sale de vfov/2) pero sí se corrige.
    expect(medicion.tomasDelAnillo).toBe(12)
    expect(medicion.deriva!.correcciones[12]).toBeCloseTo(medicion.deriva!.correcciones[6], 6)
  })

  it('también con la vuelta recorrida al revés', () => {
    // La misma vuelta, pero el sensor se queda CORTO en vez de pasarse.
    const medicion = medirDeriva(opciones(vueltaConDeriva(-5)))
    expect(medicion.deriva, medicion.motivo).not.toBeNull()
    expect(Math.abs(medicion.deriva!.grados + 5)).toBeLessThan(1)
  })

  it('no toca nada cuando el giroscopio no derivó', () => {
    const medicion = medirDeriva(opciones(vueltaConDeriva(0)))
    expect(medicion.deriva).toBeNull()
    expect(medicion.medidos).toBe(medicion.pares)
    // Y lo que midió tiene que ser casi cero, no un número cualquiera.
    expect(Math.abs(medicion.porCierre!)).toBeLessThan(0.5)
    expect(Math.abs(medicion.porCadena!)).toBeLessThan(0.5)
  })

  it('recupera también una deriva de 6° hacia el otro lado', () => {
    const medicion = medirDeriva(opciones(vueltaConDeriva(-6)))
    expect(medicion.deriva, medicion.motivo).not.toBeNull()
    expect(Math.abs(medicion.deriva!.grados + 6)).toBeLessThan(1)
  })

  it('GUARDA · no corrige una deriva imposible de 12°', () => {
    /* Con 24 tomas las vecinas quedan a 15° y se traslapan mucho, así que la
       pareja del cierre alcanza a medir un corrimiento tan grande como este.
       Con las 12 tomas del plan de verdad ni siquiera llegaría a medirse —el
       corrimiento se sale de la ventana de búsqueda— y la corrección se
       descartaría un paso antes, por no tener cierre. Las dos salidas son la
       misma: no se toca nada. */
    const medicion = medirDeriva(opciones(vueltaConDeriva(12, 24)))
    expect(medicion.deriva).toBeNull()
    expect(medicion.motivo).toContain('pico falso')
  })

  it('GUARDA · una pared lisa no da ninguna medición y se cose como hoy', () => {
    const lisas = vueltaConDeriva(6).map((toma, i) => ({
      orientacion: toma.orientacion,
      // Un degradado suavísimo: sin una sola esquina de la que agarrarse.
      grises: new Float32Array(GRIS.ancho * GRIS.alto).fill(0.5 + i * 0.001),
    }))
    const medicion = medirDeriva(opciones(lisas))
    expect(medicion.deriva).toBeNull()
    expect(medicion.medidos).toBeLessThan(medicion.pares * 0.7)
  })

  it('GUARDA · media vuelta no tiene cierre que medir', () => {
    // Seis tomas de 30° cubren 150°: la primera y la última no se ven entre sí.
    const media: TomaMedible[] = []
    for (let i = 0; i < 6; i++) {
      const yaw = 30 * i
      media.push({ orientacion: orientacionDe(yaw), grises: fotografiar(orientacionDe(yaw)) })
    }
    const medicion = medirDeriva(opciones(media))
    expect(medicion.deriva).toBeNull()
  })

  it('GUARDA · con menos de seis tomas ni se intenta', () => {
    const medicion = medirDeriva(opciones(vueltaConDeriva(6, 12).slice(0, 4)))
    expect(medicion.deriva).toBeNull()
    expect(medicion.motivo).toContain('4')
  })

  it('aguanta que falte una pareja: el resto de la cadena sigue contando', () => {
    const tomas = vueltaConDeriva(6)
    // A una toma se le borra el contenido: sus dos parejas se caen.
    tomas[5].grises = new Float32Array(GRIS.ancho * GRIS.alto).fill(0.5)
    const medicion = medirDeriva(opciones(tomas))
    expect(medicion.deriva, medicion.motivo).not.toBeNull()
    expect(medicion.medidos).toBeLessThan(medicion.pares)
    /* A la cadena le falta el pedazo de deriva de las dos parejas que no se
       midieron, y el remate del cierre es justamente el que lo devuelve: el
       total tiene que seguir saliendo cerca de los 6° inyectados. */
    expect(Math.abs(medicion.deriva!.grados - 6)).toBeLessThan(1)
    expect(medicion.porCadena!).toBeLessThan(medicion.porCierre!)
  })
  /* ---------------------------------------------------------------- ESPEJO */

  it('GUARDA · con el fotograma espejeado no se mide ni una pareja', () => {
    /* El archivo declara que si el fotograma viniera espejeado el peor caso
       sería no hacer nada. Aquí se comprueba, y en la franja que importa: entre
       0.5° y 2° una corrección con el signo cambiado pasaría las dos guardas de
       la vuelta y dejaría la peor toma al cuádruple de donde estaba. */
    for (const deriva of [0.8, 1.5, 2, 3, 6]) {
      const espejada = vueltaConDeriva(deriva).map((toma) => ({
        orientacion: toma.orientacion,
        grises: espejar(toma.grises),
      }))
      const medicion = medirDeriva(opciones(espejada))
      expect(medicion.deriva, `deriva ${deriva}: ${medicion.motivo}`).toBeNull()
      // Ni una: el corrimiento que mete el espejo es el doble del salto entre
      // tomas, o sea 60°, y eso no cabe en la ventana común de una pareja.
      expect(medicion.medidos).toBe(0)
    }
  })

  it('el espejo NO cambia el signo: quien protege es la ventana, no el parecido', () => {
    /* El control de la prueba de arriba, y la razón de que exista este archivo
       de pruebas. Con todas las tomas apuntando al mismo sitio el término del
       salto vale cero, y entonces el espejo sí se puede medir: las miniaturas
       espejadas se parecen tanto como las normales —las dos salen volteadas
       igual— y la cadena sale con el MISMO signo. O sea que la protección de la
       prueba anterior no es "las imágenes no se parecen" sino "el corrimiento
       se sale de la ventana de búsqueda", y conviene que quede clavado: si
       alguien ensancha la ventana pensando que no cuesta nada, la de arriba se
       cae y esta explica por qué. */
    const normal = medirDeriva(opciones(vueltaSinSalto(3)))
    const espejada = medirDeriva(
      opciones(
        vueltaSinSalto(3).map((toma) => ({
          orientacion: toma.orientacion,
          grises: espejar(toma.grises),
        })),
      ),
    )
    expect(normal.medidos).toBe(normal.pares)
    expect(espejada.medidos).toBe(espejada.pares)
    expect(Math.abs(normal.porCadena! - 3)).toBeLessThan(0.5)
    expect(Math.abs(espejada.porCadena! - 3)).toBeLessThan(0.5)
  })

  /* ------------------------------------------------ DESPLAZAMIENTO POR TOMA */

  it('el remate del cierre se reparte en el tramo ciego, no a lo largo de la vuelta', () => {
    /* La vuelta se corrió 2.5° de golpe entre la toma 5 y la 6 —un tropezón, un
       codazo al teléfono— y justo esas dos tomas salieron sin detalle, así que
       las tres parejas de ese tramo no se pueden medir. La cadena no ve nada, y
       todo el corrimiento aparece en el remate del cierre.

       Repartir ese remate linealmente en el índice mueve tomas cuyo tramo SÍ se
       midió bien: medido con el reparto lineal, la toma 4 se iba 0.94° y la 5
       1.16° cuando las dos tenían que quedarse quietas, más de lo que este
       archivo se equivoca en ningún caso documentado. Repartirlo entre las
       parejas que faltaron lo pone donde de verdad se perdió. */
    const tomas: TomaMedible[] = []
    for (let i = 0; i < 12; i++) {
      const yawReal = 30 * i
      const error = i >= 6 ? 2.5 : 0
      tomas.push({
        orientacion: orientacionDe(yawReal + error),
        grises:
          i === 5 || i === 6
            ? new Float32Array(GRIS.ancho * GRIS.alto).fill(0.5)
            : fotografiar(orientacionDe(yawReal)),
      })
    }

    const medicion = medirDeriva(opciones(tomas))
    expect(medicion.deriva, medicion.motivo).not.toBeNull()
    expect(medicion.medidos).toBeLessThan(medicion.pares)
    expect(Math.abs(medicion.deriva!.grados - 2.5)).toBeLessThan(0.3)

    const correcciones = medicion.deriva!.correcciones
    // Antes del tramo ciego el sensor no se había corrido: nadie se mueve.
    for (let i = 0; i <= 4; i++) {
      expect(Math.abs(correcciones[i]), `toma ${i}`).toBeLessThan(0.2)
    }
    // Después, todas cargan la vuelta entera del tropezón.
    for (let i = 7; i < 12; i++) {
      expect(Math.abs(correcciones[i] - 2.5), `toma ${i}`).toBeLessThan(0.2)
    }
  })

  it('GUARDA · no mueve una toma tres grados cuando la vuelta se corrió uno', () => {
    /* La cadena se va a +3° a media vuelta y regresa: el cierre dice que de
       punta a punta apenas hubo un grado, así que las dos guardas de la vuelta
       —el 70 % de parejas y los 8° de tope— dan las dos por buena la medición.
       Y sin embargo la corrección mandaría la toma del medio 3° lejos de donde
       estaba, el triple de lo que se movió la vuelta entera.

       Un giroscopio no hace eso: el sesgo se integra y no vuelve sobre sus
       pasos en los cuarenta segundos que dura una captura. Una correlación
       enganchada a un patrón que se repite, sí. Ante la duda no se toca nada,
       que es como sale hoy la panorámica. */
    const perfil = [0, 0.7, 1.4, 2.1, 2.8, 3.0, 2.6, 2.2, 1.8, 1.2, 0.4, -1.0]
    const tomas: TomaMedible[] = perfil.map((error, i) => ({
      orientacion: orientacionDe(30 * i + error),
      grises: fotografiar(orientacionDe(30 * i)),
    }))

    const medicion = medirDeriva(opciones(tomas))
    // Las guardas viejas no ven nada raro: se midió todo y el cierre es chico.
    expect(medicion.medidos).toBe(medicion.pares)
    expect(Math.abs(medicion.porCierre!)).toBeLessThan(2)
    // La nueva sí.
    expect(medicion.deriva).toBeNull()
    expect(medicion.motivo).toContain('eso no es deriva')
  })
})

describe('el giro de base', () => {
  it('yaw(Ry(θ)·q) = yaw(q) − θ, que es de donde cuelgan los signos', () => {
    /* Esta identidad es la que sostiene dos cosas que no se parecen entre sí:

         · El signo de la corrección de este archivo. `recoser()` pega cada toma
           con `Ry(baseYaw + ajuste)·q`, así que `ajuste = e(k)` RESTA el error
           del sensor en vez de sumarlo. Si la identidad fuera al revés, todas
           las correcciones estarían del lado contrario.
         · El rumbo que se escribe en `GPano:PoseHeadingDegrees`. El centro de la
           equirectangular es el yaw 0 de la PANORÁMICA, y por esta identidad ese
           yaw 0 corresponde al yaw CRUDO `baseYaw`, no al yaw crudo 0. Por eso
           el rumbo del centro es `baseYaw + offsetNorte` y no `offsetNorte` a
           secas, que es un número girado por el cero arbitrario de `alpha`.

       Se comprueba con inclinación y ladeo encima: la identidad tiene que valer
       para cualquier orientación, no solo para el teléfono perfectamente
       vertical mirando al horizonte. */
    const Y = new THREE.Vector3(0, 1, 0)

    for (const yawCrudo of [0, 37, -110, 179]) {
      for (const inclinacion of [0, 25, -40]) {
        for (const ladeo of [0, 15]) {
          for (const base of [0, 47, -132]) {
            const q = orientacionDe(yawCrudo, inclinacion, ladeo)
            const girada = new THREE.Quaternion()
              .setFromAxisAngle(Y, base * DEG)
              .multiply(q)
            const esperado = wrap180(anglesOf(q).yaw - base)
            expect(
              Math.abs(wrap180(anglesOf(girada).yaw - esperado)),
              `yaw ${yawCrudo}, base ${base}`,
            ).toBeLessThan(1e-6)
          }
        }
      }
    }
  })
})

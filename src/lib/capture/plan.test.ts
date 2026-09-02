import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { DEG } from '../math'
import { yawPitchToVector3 } from '../math3d'
import { fovDe } from './frames'
import {
  avanceRecomendado,
  planDeCaptura,
  puntoMasCercano,
  separacion,
  TOLERANCIA_DEG,
} from './plan'

/**
 * ============================================================================
 *  ¿DE VERDAD NO QUEDAN HUECOS?
 * ============================================================================
 *
 * El plan de captura promete una sola cosa: que si el usuario toma todas las
 * fotos que le marca, no queda ni un pedazo de la esfera sin fotografiar. Es
 * una promesa fácil de romper sin darse cuenta —basta cambiar un traslape o
 * mover un anillo— y carísima de descubrir, porque el hueco no aparece hasta
 * que alguien recorre la casa entera, cose la panorámica y encuentra una franja
 * gris en el techo. Aquí se comprueba en un segundo.
 *
 * ── El criterio ingenuo está mal, y falla el primer día ────────────────────
 *
 * Lo primero que uno escribe es: "una dirección está cubierta si hay una foto a
 * menos de hfov/2 grados de ella". O sea, tratar la foto como un casquete
 * redondo. Y es falso: lo que cubre una foto es un RECTÁNGULO de hfov por vfov.
 * Por las esquinas alcanza más lejos que hfov/2, y por arriba y por abajo
 * alcanza menos.
 *
 * No es una sutileza teórica. Con el teléfono en vertical y un lente de 66° en
 * el lado largo (hfov = 51.9°, vfov = 66°), muestreando la esfera se encuentra
 * una dirección que queda a 27.0° de la foto más cercana, contra los 25.97° que
 * el casquete exigiría. El plan estaría bien y la prueba diría que está roto.
 *
 * ── El criterio que sí corresponde ─────────────────────────────────────────
 *
 * Se lleva la dirección al marco de cada foto —girando por la inversa de la
 * misma orientación que arma el CameraRig, Euler YXZ con y = -yaw y x = +pitch—
 * y ahí se pregunta lo que de verdad importa: si cae dentro del cuadro. Que es
 * pedir tres cosas:
 *
 *   · que esté DELANTE del lente (z < 0; la cámara mira hacia -Z);
 *   · que no se pase de la orilla izquierda o derecha: |x / z| ≤ tan(hfov/2);
 *   · que no se pase de la de arriba o abajo:          |y / z| ≤ tan(vfov/2).
 *
 * Las dos últimas son la división de la perspectiva, la misma que hace
 * `yawPitchToScreen` para saber en qué píxel cae un hotspot. Por eso el margen
 * que se reporta abajo no va en grados sino como fracción del semicuadro:
 * −0.11 quiere decir "sobró un 11 % del ancho de la foto".
 *
 * Medido hoy con esta prueba, el peor caso de cada forma de fotograma deja
 * entre un 6 % y un 16 % de sobra. No es mucho, y es a propósito: el plan está
 * ajustado para no pedir fotos de más. De hecho, si cada foto abarcara un 10 %
 * menos de lo que dice abarcar, ese margen se acabaría justo: en tres de las
 * cinco formas el peor caso queda entre −0.005 y 0.000. Por eso importa que la
 * calibración del campo de visión no se quede corta.
 */

/** Cuántas direcciones se muestrean. 720 × 360 son 260 mil, y no tarda nada. */
const PASOS_YAW = 720
const PASOS_PITCH = 360

type Hueco = { margen: number; yaw: number; pitch: number }

/**
 * La dirección peor cubierta de toda la esfera.
 *
 * `margen` va en fracciones del semicuadro: negativo es "cabe dentro de alguna
 * foto", cero es justo la orilla, positivo es un hueco.
 */
function peorHueco(hfov: number, vfov: number, encoge = 1): Hueco {
  const puntos = planDeCaptura({ hfov, vfov })

  // Mundo → marco de la foto, una por punto y calculada una sola vez.
  const aLaFoto = puntos.map((p) =>
    new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(p.pitch * DEG, -p.yaw * DEG, 0, 'YXZ'))
      .invert(),
  )

  // `encoge` sirve para el control negativo de más abajo: se planifica con un
  // campo de visión y se mide la cobertura con otro más chico.
  const tanH = Math.tan(((hfov * encoge) / 2) * DEG)
  const tanV = Math.tan(((vfov * encoge) / 2) * DEG)
  const direccion = new THREE.Vector3()
  const enLaFoto = new THREE.Vector3()

  let peor: Hueco = { margen: -Infinity, yaw: 0, pitch: 0 }

  for (let iy = 0; iy < PASOS_YAW; iy++) {
    const yaw = -180 + (iy * 360) / PASOS_YAW

    for (let ip = 0; ip <= PASOS_PITCH; ip++) {
      const pitch = -90 + (ip * 180) / PASOS_PITCH
      yawPitchToVector3(yaw, pitch, 1, direccion)

      let mejor = Infinity
      for (const inversa of aLaFoto) {
        enLaFoto.copy(direccion).applyQuaternion(inversa)
        if (enLaFoto.z >= 0) continue // queda detrás del lente

        const m = Math.max(
          Math.abs(enLaFoto.x / enLaFoto.z) / tanH - 1,
          Math.abs(enLaFoto.y / enLaFoto.z) / tanV - 1,
        )
        if (m < mejor) mejor = m
      }

      /* Se miran TODAS las fotos y no se corta en la primera que cubre. Cortar
         antes va cuatro veces más rápido y sigue detectando el hueco, pero el
         margen que se reporta deja de ser el real: pasa a ser el de la primera
         foto de la lista que alcanzó, que puede rozar el cero aunque haya otra
         cubriendo esa dirección de sobra. El número que sale en el mensaje de
         error tiene que servir para saber si el plan va justo o va holgado. */
      if (mejor > peor.margen) peor = { margen: mejor, yaw, pitch }
    }
  }

  return peor
}

describe('planDeCaptura no deja huecos', () => {
  /* Las formas de fotograma que salen de una cámara de teléfono, acostado y
     parado, con lentes de gran angular y de los normales. El teléfono parado
     está incluido a propósito: es como la gente sostiene el celular por
     defecto, y es el caso donde el criterio del casquete se equivocaba. */
  const casos: Array<[string, number, number, number]> = [
    ['4:3 acostado, lente de 66°', 4032, 3024, 66],
    ['3:4 parado, lente de 66°', 3024, 4032, 66],
    ['16:9 acostado, lente de 66°', 1920, 1080, 66],
    ['3:4 parado, gran angular de 100°', 3024, 4032, 100],
    ['1:1, lente de 50°', 1000, 1000, 50],
  ]

  for (const [nombre, width, height, largo] of casos) {
    it(`${nombre}`, () => {
      const { hfov, vfov } = fovDe(width, height, largo)
      const peor = peorHueco(hfov, vfov)
      // El mensaje trae la dirección: si algún día falla, se sabe dónde mirar.
      expect(
        peor.margen,
        `hueco en yaw ${peor.yaw.toFixed(2)}°, pitch ${peor.pitch.toFixed(2)}°`,
      ).toBeLessThan(0)
    })
  }

  /* Control negativo. Sin esto, la prueba de arriba podría estar pasando por
     un error en la cuenta —un signo, un tan() de más— en vez de porque el plan
     esté bien. Si cada foto abarcara un 15 % menos de lo planeado, tiene que
     aparecer un hueco; si tampoco aparece, es que aquí no se está midiendo
     nada. */
  it('detecta el hueco si las fotos abarcan un 15 % menos de lo planeado', () => {
    const { hfov, vfov } = fovDe(4032, 3024, 66)
    expect(peorHueco(hfov, vfov, 0.85).margen).toBeGreaterThan(0)
  })
})

describe('la forma del plan', () => {
  const plan = planDeCaptura(fovDe(4032, 3024))

  it('manda una foto al cenit y otra al nadir, y solo una de cada', () => {
    expect(plan.filter((p) => p.pitch === 90)).toHaveLength(1)
    expect(plan.filter((p) => p.pitch === -90)).toHaveLength(1)
  })

  /* Los ids son la llave con la que la pantalla de captura marca qué ya se
     tomó. Dos puntos con el mismo id son dos fotos que se tachan juntas, o sea
     una que nunca se pide. */
  it('no repite ningún id', () => {
    expect(new Set(plan.map((p) => p.id)).size).toBe(plan.length)
  })

  /* El rango es [-180, 180), no (-180, 180]: el plan arma el yaw con
     `((x + 180) % 360) - 180`, y con un anillo de un número par de fotos la de
     atrás cae en -180 exacto. Da lo mismo —-180 y +180 son la misma
     dirección— pero conviene dejarlo escrito, porque quien compare yaws sin
     normalizar va a encontrarse con el signo. */
  it('deja todos los yaw dentro de [-180, 180)', () => {
    for (const p of plan) {
      expect(p.yaw).toBeGreaterThanOrEqual(-180)
      expect(p.yaw).toBeLessThan(180)
    }
  })

  /* Cada anillo tiene que dar la vuelta completa: si el último punto y el
     primero quedaran a más de un paso, el hueco caería justo en la espalda del
     usuario, que es donde nadie lo revisa. */
  it('cierra cada anillo en el yaw 360 sin salto', () => {
    const porAnillo = new Map<number, number[]>()
    for (const p of plan) {
      const yaws = porAnillo.get(p.anillo) ?? []
      yaws.push(p.yaw)
      porAnillo.set(p.anillo, yaws)
    }
    for (const yaws of porAnillo.values()) {
      if (yaws.length < 2) continue
      const orden = [...yaws].sort((a, b) => a - b)
      const paso = orden[1] - orden[0]
      const cierre = 360 - (orden[orden.length - 1] - orden[0])
      expect(Math.abs(cierre - paso)).toBeLessThan(1e-9)
    }
  })

  it('con alcance "vuelta" solo pide el anillo del horizonte', () => {
    const vuelta = planDeCaptura({ ...fovDe(4032, 3024), alcance: 'vuelta' })
    expect(vuelta.every((p) => p.pitch === 0)).toBe(true)
    expect(vuelta.length).toBeGreaterThan(3)
  })
})

describe('avanceRecomendado', () => {
  /* El avance sale de descontarle dos tolerancias al campo de visión, porque
     dos fotos vecinas pueden salir desviadas esa cantidad y hacia lados
     contrarios. Ver el encabezado de plan.ts. */
  it('descuenta dos tolerancias del campo de visión', () => {
    expect(avanceRecomendado(66)).toBeCloseTo((66 - 2 * TOLERANCIA_DEG) / 66, 12)
  })

  it('no se pasa del 80 % ni baja del 35 %', () => {
    // Un ojo de pez enorme: descontar dos tolerancias casi no le quita nada.
    expect(avanceRecomendado(180)).toBe(0.8)
    // Un teleobjetivo: sin el piso, el plan pediría cientos de fotos.
    expect(avanceRecomendado(30)).toBe(0.35)
  })
})

describe('separacion y puntoMasCercano', () => {
  it('mide la distancia angular por el camino corto', () => {
    expect(separacion(0, 0, 0, 0)).toBeCloseTo(0, 12)
    expect(separacion(-179, 0, 179, 0)).toBeCloseTo(2, 12)
    expect(separacion(0, 0, 0, 90)).toBeCloseTo(90, 12)
    expect(separacion(0, 0, 180, 0)).toBeCloseTo(180, 12)
  })

  it('elige el pendiente más cercano y se salta los ya tomados', () => {
    const plan = planDeCaptura(fovDe(4032, 3024))
    const objetivo = plan[5]

    const sinNada = puntoMasCercano(plan, new Set(), objetivo.yaw, objetivo.pitch)
    expect(sinNada?.punto.id).toBe(objetivo.id)
    expect(sinNada?.distancia).toBeCloseTo(0, 9)

    const yaTomado = puntoMasCercano(plan, new Set([objetivo.id]), objetivo.yaw, objetivo.pitch)
    expect(yaTomado?.punto.id).not.toBe(objetivo.id)
    expect(yaTomado?.distancia).toBeGreaterThan(0)
  })

  it('cuando ya no queda nada pendiente devuelve null', () => {
    const plan = planDeCaptura(fovDe(4032, 3024))
    expect(puntoMasCercano(plan, new Set(plan.map((p) => p.id)), 0, 0)).toBeNull()
  })
})

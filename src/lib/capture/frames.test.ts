import { describe, expect, it } from 'vitest'

import {
  FOV_LADO_LARGO,
  deltaYawMedido,
  fovDe,
  ladoLargoDesdeHorizontal,
  mediana,
} from './frames'

/**
 * ============================================================================
 *  LAS DOS CUENTAS QUE SOSTIENEN LA CALIBRACIÓN
 * ============================================================================
 *
 * `fovDe` y `ladoLargoDesdeHorizontal` van en sentidos contrarios y el código
 * las usa encadenadas: la calibración con el giroscopio mide un campo
 * HORIZONTAL, lo convierte al del lado largo para guardarlo —que es como se
 * guarda, porque no depende de cómo se sostenga el teléfono— y al rato lo
 * vuelve a abrir en horizontal y vertical para armar el plan.
 *
 * Si una de las dos se desvía, la otra no lo compensa: el error se acumula y
 * el plan de captura queda calculado con un lente que no existe. Aquí se
 * comprueba que dan la vuelta completa y regresan al mismo número.
 *
 * Nada de esto toca el DOM. Lo que sí lo toca —congelar el fotograma, medir el
 * brillo, la correlación cruzada— vive en el mismo archivo pero necesita un
 * canvas de verdad, y un canvas simulado mide otra cosa que la que se quiere
 * probar. Eso se sigue verificando con tools/pruebas/costura.html.
 */

describe('fovDe', () => {
  /* Un cuadrado no tiene lado largo, así que los dos campos valen lo mismo.
     Es el caso donde un `>=` mal puesto se nota. */
  it('en un cuadrado los dos campos son iguales', () => {
    const { hfov, vfov } = fovDe(1000, 1000, 66)
    expect(hfov).toBeCloseTo(66, 10)
    expect(vfov).toBeCloseTo(66, 10)
  })

  /* Girar el teléfono no cambia la lente: cambia cuál de los dos campos es el
     ancho. Los números tienen que salir intercambiados, no recalculados. */
  it('al girar el teléfono los dos campos se intercambian', () => {
    const horizontal = fovDe(4032, 3024)
    const vertical = fovDe(3024, 4032)
    expect(horizontal.hfov).toBeCloseTo(vertical.vfov, 10)
    expect(horizontal.vfov).toBeCloseTo(vertical.hfov, 10)
    expect(horizontal.hfov).toBe(FOV_LADO_LARGO)
  })

  /* El campo corto sale de la proporción del sensor, no de una regla de tres
     sobre los grados: los ángulos no se reparten así. Con 66° en 4:3 el campo
     corto es 51.94°, y una regla de tres daría 49.5°. */
  it('el campo corto sale de la tangente y no de una regla de tres', () => {
    expect(fovDe(4032, 3024, 66).vfov).toBeCloseTo(51.937, 3)
    expect(fovDe(1920, 1080, 66).vfov).toBeCloseTo(40.134, 3)
  })
})

describe('ladoLargoDesdeHorizontal deshace a fovDe', () => {
  it('regresa al mismo lado largo en cualquier forma de fotograma', () => {
    const formas: Array<[number, number]> = [
      [4032, 3024],
      [3024, 4032],
      [1920, 1080],
      [1080, 1920],
      [1280, 720],
      [1000, 1000],
    ]
    for (const [width, height] of formas) {
      for (let largo = 30; largo <= 110; largo += 5) {
        const { hfov } = fovDe(width, height, largo)
        expect(ladoLargoDesdeHorizontal(hfov, width, height)).toBeCloseTo(largo, 9)
      }
    }
  })

  /* Con el teléfono acostado el lado largo YA es el horizontal, así que la
     conversión es la identidad. Si algún día alguien mete una tangente de más
     aquí, esta línea lo dice. */
  it('con el teléfono acostado no convierte nada', () => {
    expect(ladoLargoDesdeHorizontal(71.3, 1920, 1080)).toBe(71.3)
  })
})

describe('mediana', () => {
  it('sin datos no inventa un número', () => {
    expect(mediana([])).toBeNull()
  })

  it('con impares toma el de en medio y con pares promedia los dos', () => {
    expect(mediana([3, 1, 2])).toBe(2)
    expect(mediana([4, 1, 3, 2])).toBe(2.5)
    expect(mediana([7])).toBe(7)
  })

  /* La razón de ser de la mediana en la calibración: una lectura absurda no
     debe mover el resultado. El promedio de estos cinco da 20 112. */
  it('un dato loco no arrastra el resultado', () => {
    expect(mediana([64, 65, 66, 67, 100_300])).toBe(66)
  })

  /* Quien llama pasa el arreglo que va acumulando durante el barrido y lo
     sigue usando después. Si la mediana lo ordenara en el lugar, las lecturas
     dejarían de estar en orden de tiempo. */
  it('no reordena el arreglo que le pasaron', () => {
    const valores = [3, 1, 2]
    mediana(valores)
    expect(valores).toEqual([3, 1, 2])
  })
})

/**
 * ============================================================================
 *  MEDIR EL GIRO CON LA IMAGEN
 * ============================================================================
 *
 * Matiz sobre el encabezado de arriba: lo que necesita un canvas de verdad es
 * SACAR los grises de un fotograma (`grisesReducidos`), no la correlación en sí,
 * que recibe un `Float32Array` y no sabe de dónde salió. Por eso esta parte sí
 * se puede probar sin navegador: se fabrica un mundo de una sola dimensión y se
 * recortan dos ventanas separadas por un número conocido de píxeles, que es
 * exactamente lo que le pasa a la imagen cuando el teléfono gira.
 *
 * Lo que estas pruebas NO cubren, y hay que decirlo: el mundo sintético no tiene
 * ruido de sensor, ni desenfoque de movimiento, ni cambio de exposición, así que
 * las correlaciones salen en 1.000 y el subpíxel acierta al centésimo. En un
 * cuarto de verdad la correlación buena anda por 0.6 u 0.8. Lo que se comprueba
 * aquí es la CUENTA —la fórmula, el signo y las guardas—, no la calidad de la
 * medición en un cuarto real.
 */

const MUNDO_LARGO = 400
const TOMA = { width: 96, height: 72 }
/** El lente de siempre (66° en el lado largo) sobre una miniatura de 96 px. */
const FOCAL_PX = TOMA.width / (2 * Math.tan((33 * Math.PI) / 180))

/** Una pared con textura: ruido reproducible, suavizado para que no sea aleatorio puro. */
const MUNDO = (() => {
  const crudo = new Float32Array(MUNDO_LARGO)
  let estado = 0x1f2e3d4
  for (let i = 0; i < MUNDO_LARGO; i++) {
    estado = (estado * 1103515245 + 12345) & 0x7fffffff
    crudo[i] = ((estado >>> 12) & 0xff) / 255
  }
  const suave = new Float32Array(MUNDO_LARGO)
  for (let i = 0; i < MUNDO_LARGO; i++) {
    const antes = crudo[(i - 1 + MUNDO_LARGO) % MUNDO_LARGO]
    const despues = crudo[(i + 1) % MUNDO_LARGO]
    suave[i] = (antes + 2 * crudo[i] + despues) / 4
  }
  return suave
})()

/** La ventana del mundo que ve la cámara desde cierta posición. */
function toma(desde: number): Float32Array {
  const { width, height } = TOMA
  const imagen = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const valor = MUNDO[(desde + x + MUNDO_LARGO) % MUNDO_LARGO]
      // Las filas no son idénticas: si lo fueran, la correlación estaría
      // midiendo una sola línea repetida 72 veces.
      imagen[y * width + x] = valor * (0.7 + 0.3 * Math.sin(y * 0.3))
    }
  }
  return imagen
}

/** Girar a la derecha `k` píxeles = ver el mundo `k` más allá. */
function medir(k: number, extra: Partial<Parameters<typeof deltaYawMedido>[0]> = {}) {
  return deltaYawMedido({
    anterior: toma(100),
    actual: toma(100 + k),
    width: TOMA.width,
    height: TOMA.height,
    focalPx: FOCAL_PX,
    ...extra,
  })
}

const ideal = (k: number) => (Math.atan(k / FOCAL_PX) * 180) / Math.PI

describe('deltaYawMedido', () => {
  /* La cuenta al derecho: si el mundo se corrió k píxeles, el ángulo tiene que
     salir atan(k/f). Se comprueba en todo el rango que la búsqueda alcanza,
     desde los 2° que apenas se distinguen del subpíxel hasta los 28° donde ya
     casi no queda traslape. */
  it('recupera el ángulo que se le metió', () => {
    for (const k of [-40, -20, -8, -3, 3, 8, 20, 30, 40]) {
      const medido = medir(k)
      expect(medido).not.toBeNull()
      expect(medido?.grados).toBeCloseTo(ideal(k), 1)
    }
  })

  /* El signo es lo que decide si una corrección de deriva endereza la vuelta o
     la tuerce al doble. Girar a la derecha (yaw que crece) tiene que dar
     positivo, y el contenido de la imagen se corre al revés que el teléfono. */
  it('el signo sigue al giro y no al corrimiento de la imagen', () => {
    expect(medir(12)?.grados).toBeGreaterThan(0)
    expect(medir(-12)?.grados).toBeLessThan(0)
  })

  /* Una pared blanca no tiene de dónde agarrarse: no hay pico, hay meseta. Es
     el caso que la recomendación acepta como "aquí no se corrige nada". */
  it('una pared lisa no da medición', () => {
    const plana = new Float32Array(TOMA.width * TOMA.height).fill(0.5)
    expect(
      deltaYawMedido({
        anterior: plana,
        actual: plana,
        width: TOMA.width,
        height: TOMA.height,
        focalPx: FOCAL_PX,
      }),
    ).toBeNull()
  })

  /* Dos tomas que no comparten nada tampoco. Si esto devolviera un número, la
     corrección se aplicaría con basura. */
  it('dos tomas sin nada en común tampoco', () => {
    let estado = 7
    const ruido = () => {
      estado = (estado * 1103515245 + 12345) & 0x7fffffff
      return ((estado >>> 12) & 0xff) / 255
    }
    const a = Float32Array.from({ length: TOMA.width * TOMA.height }, ruido)
    const b = Float32Array.from({ length: TOMA.width * TOMA.height }, ruido)
    expect(
      deltaYawMedido({
        anterior: a,
        actual: b,
        width: TOMA.width,
        height: TOMA.height,
        focalPx: FOCAL_PX,
      }),
    ).toBeNull()
  })

  /* La búsqueda solo llega al 45 % del ancho. Más allá, el mejor corrimiento
     probado queda pegado al borde y no es un pico: es el final de la lista. */
  it('no jura un ángulo cuando el pico se quedó fuera de la búsqueda', () => {
    expect(medir(44)).toBeNull()
  })

  /* El cuarto que se repite —azulejo, celosía, un pasillo de puertas iguales—
     es donde la correlación encuentra un pico ALTO y EQUIVOCADO. Aquí el mundo
     sintético da la vuelta cada 400 px, así que a 50 px de giro la correlación
     se engancha con confianza 0.74 en un ángulo que no tiene nada que ver.
     Contra eso no hay umbral que valga: la única defensa es contrastar con el
     giroscopio, y por eso existe `esperado`. */
  it('el giroscopio descarta el pico falso de un cuarto repetitivo', () => {
    const enganchado = medir(50)
    expect(enganchado).not.toBeNull()
    expect(Math.abs((enganchado?.grados ?? 0) - ideal(50))).toBeGreaterThan(10)
    expect(medir(50, { esperado: ideal(50) })).toBeNull()
  })

  /* Y la otra cara: una medición buena tiene que SOBREVIVIR al contraste. Si el
     giroscopio se desvió los 2° que justamente se quieren corregir, la medición
     pasa; si el desacuerdo es de 20°, ya no es deriva. */
  it('una medición que se parece al giroscopio sí pasa', () => {
    expect(medir(20, { esperado: ideal(20) + 2 })?.grados).toBeCloseTo(ideal(20), 1)
    expect(medir(20, { esperado: ideal(20) + 20 })).toBeNull()
    // Y la tolerancia se puede apretar desde fuera.
    expect(medir(20, { esperado: ideal(20) + 2, tolerancia: 1 })).toBeNull()
  })

  /* Inclinado hacia arriba, el mismo giro del mundo barre MENOS delante del
     lente, así que el mismo corrimiento de imagen corresponde a un giro mayor.
     Es la misma corrección geométrica que ya hace `estimarFovConGiro`, aquí
     despejada al revés: el ángulo medido se divide entre cos(pitch). */
  it('corrige la inclinación igual que la calibración', () => {
    const derecho = medir(8)?.grados ?? 0
    const inclinado = medir(8, { pitch: 40 })?.grados ?? 0
    expect(inclinado).toBeCloseTo(derecho / Math.cos((40 * Math.PI) / 180), 2)
  })

  /* Focal imposible: sin distancia focal no hay ángulo, y un cero partiría la
     cuenta. Boca arriba tampoco: ahí el coseno de la inclinación se acerca a
     cero y dividir entre él convierte medio píxel de error en decenas de grados. */
  it('se planta ante parámetros que no permiten una cuenta honesta', () => {
    expect(medir(8, { focalPx: 0 })).toBeNull()
    expect(medir(8, { focalPx: -10 })).toBeNull()
    expect(medir(8, { focalPx: Number.NaN })).toBeNull()
    expect(medir(8, { pitch: 80 })).toBeNull()
    expect(medir(8, { roll: 60 })).toBeNull()
  })
})

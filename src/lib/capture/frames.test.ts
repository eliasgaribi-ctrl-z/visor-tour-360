import { describe, expect, it } from 'vitest'

import { FOV_LADO_LARGO, fovDe, ladoLargoDesdeHorizontal, mediana } from './frames'

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

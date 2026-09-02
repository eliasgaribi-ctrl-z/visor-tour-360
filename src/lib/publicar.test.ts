import { describe, expect, it } from 'vitest'

import type { StoredTour } from './store/types'
import { armarManifiesto, llaveValida, manifiestoATour, nombreDeFoto } from './publicar'

/**
 * ============================================================================
 *  PUBLICAR UNA CASA
 * ============================================================================
 *
 * Se prueba lo que es de datos a datos: armar el manifiesto que se sube y leer
 * el que baja. La subida en sí necesita red y no se prueba aquí.
 *
 * Importa más de lo que parece, porque este manifiesto es lo ÚNICO que ve el
 * cliente: si sale mal, no se rompe nada visible de este lado —el recorrido
 * sigue perfecto en el teléfono— y el que se encuentra la casa a medias es
 * alguien a quien le mandaste un link.
 */

function tourDe(escenas: Partial<StoredTour['scenes'][number]>[], extra: Partial<StoredTour> = {}): StoredTour {
  return {
    id: 't1',
    title: 'Casa en Tlajomulco',
    startSceneId: escenas[0]?.id ?? 'a',
    createdAt: 0,
    updatedAt: 0,
    ...extra,
    scenes: escenas.map((e, i) => ({
      id: e.id ?? `h${i}`,
      name: e.name ?? `Cuarto ${i}`,
      imageId: 'imageId' in e ? (e.imageId as string) : `img${i}`,
      thumbId: e.thumbId,
      initialYaw: e.initialYaw,
      hotspots: e.hotspots ?? [],
      createdAt: 0,
    })),
  }
}

describe('nombreDeFoto', () => {
  it('numera con tres cifras para que el orden alfabetico sea el orden real', () => {
    expect(nombreDeFoto(0)).toBe('000.jpg')
    expect(nombreDeFoto(9)).toBe('009.jpg')
    expect(nombreDeFoto(12, true)).toBe('012.min.jpg')
  })

  it('coincide con la forma que el Worker admite', () => {
    /* El Worker rechaza cualquier otro nombre. Si estas dos formas se separan,
       la subida falla entera y aquí es donde se ve primero. */
    const admitido = /^[0-9]{3}(\.min)?\.jpg$/
    for (const i of [0, 5, 47, 999]) {
      expect(admitido.test(nombreDeFoto(i))).toBe(true)
      expect(admitido.test(nombreDeFoto(i, true))).toBe(true)
    }
  })
})

describe('llaveValida', () => {
  it('acepta una llave de las que genera el Worker', () => {
    expect(llaveValida('abcdefghijkmnpqrstuvwxyz2')).toBe(false) // 25: corta
    expect(llaveValida('abcdefghijkmnpqrstuvwxyz23')).toBe(true) // 26
  })

  it('rechaza las letras que se confunden al leerlas', () => {
    /* El alfabeto deja fuera l, o, 0 y 1 a proposito. Una llave con ellas no
       salio de nuestro Worker. */
    expect(llaveValida('lbcdefghijkmnpqrstuvwxyz23')).toBe(false)
    expect(llaveValida('obcdefghijkmnpqrstuvwxyz23')).toBe(false)
    expect(llaveValida('0bcdefghijkmnpqrstuvwxyz23')).toBe(false)
  })

  it('rechaza lo que intenta salirse de su sitio', () => {
    for (const malo of ['', '../etc/passwd', 'abc/def', 'ABCDEFGHIJKMNPQRSTUVWXYZ23']) {
      expect(llaveValida(malo)).toBe(false)
    }
  })
})

describe('armarManifiesto', () => {
  it('numera las fotos por posicion, no por el id de la habitacion', () => {
    /* El id puede venir de un .tour que mando otra persona. Usarlo como nombre
       de archivo seria dejar que un tercero elija donde se escribe. */
    const m = armarManifiesto(tourDe([{ id: '../../hackeado' }, { id: 'sala' }]))
    expect(m.scenes.map((e) => e.foto)).toEqual(['000.jpg', '001.jpg'])
  })

  it('deja fuera las habitaciones sin foto y renumera las que quedan', () => {
    const m = armarManifiesto(tourDe([{ id: 'a' }, { id: 'b', imageId: '' }, { id: 'c' }]))
    expect(m.scenes.map((e) => e.id)).toEqual(['a', 'c'])
    expect(m.scenes.map((e) => e.foto)).toEqual(['000.jpg', '001.jpg'])
  })

  it('tira los puntos que llevan a una habitacion que se quedo fuera', () => {
    /* Seria un boton que no hace nada, en casa del cliente. */
    const m = armarManifiesto(
      tourDe([
        {
          id: 'a',
          hotspots: [
            { id: 'p1', kind: 'link', to: 'b', yaw: 0, pitch: 0, label: 'A la cocina' },
            { id: 'p2', kind: 'link', to: 'c', yaw: 0, pitch: 0, label: 'A la sala' },
            { id: 'p3', kind: 'info', yaw: 0, pitch: 0, label: 'Nota' },
          ],
        },
        { id: 'b', imageId: '' },
        { id: 'c' },
      ]),
    )
    expect(m.scenes[0].hotspots.map((h) => (h as { id: string }).id)).toEqual(['p2', 'p3'])
  })

  it('si la habitacion de inicio se quedo fuera, arranca en la primera que si esta', () => {
    const m = armarManifiesto(tourDe([{ id: 'a', imageId: '' }, { id: 'b' }], { startSceneId: 'a' }))
    expect(m.startSceneId).toBe('b')
  })

  it('solo pide miniatura cuando de verdad hay una guardada', () => {
    const m = armarManifiesto(tourDe([{ id: 'a', thumbId: 'th0' }, { id: 'b' }]))
    expect(m.scenes[0].miniatura).toBe('000.min.jpg')
    expect(m.scenes[1].miniatura).toBeUndefined()
  })
})

describe('manifiestoATour', () => {
  const llave = 'abcdefghijkmnpqrstuvwxyz23'

  it('convierte los nombres de archivo en direcciones que el visor puede bajar', () => {
    const tour = manifiestoATour(llave, {
      version: 1,
      title: 'Casa',
      startSceneId: 'a',
      scenes: [{ id: 'a', name: 'Sala', foto: '000.jpg', miniatura: '000.min.jpg', initialYaw: 0, hotspots: [] }],
    })
    expect(tour.scenes[0].image).toContain(`/t/${llave}/fotos/000.jpg`)
    expect(tour.scenes[0].thumbnail).toContain(`/t/${llave}/fotos/000.min.jpg`)
  })

  it('no revienta con un manifiesto al que le falta todo', () => {
    /* Lo que baja del servidor es JSON de la red: se trata como entrada, no
       como algo de confianza. */
    expect(() => manifiestoATour(llave, null)).toThrow()
    expect(() => manifiestoATour(llave, {})).toThrow()
    expect(() => manifiestoATour(llave, { scenes: [] })).toThrow()
    expect(() => manifiestoATour(llave, { scenes: [{ id: 'a', name: 'x' }] })).toThrow()
  })

  it('cae en la primera habitacion si la de inicio no existe', () => {
    const tour = manifiestoATour(llave, {
      startSceneId: 'fantasma',
      scenes: [{ id: 'a', name: 'Sala', foto: '000.jpg', initialYaw: 0, hotspots: [] }],
    })
    expect(tour.startSceneId).toBe('a')
  })
})

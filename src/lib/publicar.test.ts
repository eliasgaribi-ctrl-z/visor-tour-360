import { describe, expect, it } from 'vitest'

import type { StoredTour } from './store/types'
import { armarManifiesto, llaveValida, manifiestoATour, nombreDeFoto, nombreDeLogo } from './publicar'

/**
 * ============================================================================
 *  PUBLICAR UNA CASA
 * ============================================================================
 *
 * Se prueba lo que es de datos a datos: armar el manifiesto que se sube y leer
 * el que baja. La subida en sí necesita red y la prueba `tools/pruebas/publicar.mjs`
 * con un Worker local.
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
      rumbo: e.rumbo,
      nivel: e.nivel,
      coverageDeg: e.coverageDeg,
      createdAt: 0,
    })),
  }
}

describe('nombreDeFoto', () => {
  it('numera con tres cifras para que el orden alfabetico sea el orden real', () => {
    expect(nombreDeFoto(0)).toBe('000.jpg')
    expect(nombreDeFoto(9)).toBe('009.jpg')
    expect(nombreDeFoto(12, 'min')).toBe('012.min.jpg')
    expect(nombreDeFoto(3, '2k')).toBe('003.2k.jpg')
  })

  it('coincide con la forma que el Worker admite', () => {
    /* El Worker rechaza cualquier otro nombre. Si estas formas se separan, la
       subida falla entera y aquí es donde se ve primero. */
    const admitido = /^[0-9]{3}(\.min|\.2k)?\.jpg$/
    for (const i of [0, 5, 47, 999]) {
      expect(admitido.test(nombreDeFoto(i))).toBe(true)
      expect(admitido.test(nombreDeFoto(i, 'min'))).toBe(true)
      expect(admitido.test(nombreDeFoto(i, '2k'))).toBe(true)
    }
  })
})

describe('nombreDeLogo', () => {
  it('lleva la extension de su tipo real, y nada fuera de la lista', () => {
    /* El Worker exige que el nombre y la firma del archivo coincidan: un
       `logo.png` con otra cosa dentro no se sirve como PNG. Y un SVG no entra:
       es un vector de XSS, igual que en el `.tour`. */
    expect(nombreDeLogo('image/png')).toBe('logo.png')
    expect(nombreDeLogo('image/jpeg')).toBe('logo.jpg')
    expect(nombreDeLogo('image/webp')).toBe('logo.webp')
    expect(nombreDeLogo('image/svg+xml')).toBeUndefined()
    expect(nombreDeLogo('')).toBeUndefined()
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

  it('es la version 2 y declara la variante de 2048 de cada habitacion', () => {
    /* Quien sube borra la declaracion de las que no pudo producir; el
       manifiesto que se arma aqui promete todas. */
    const m = armarManifiesto(tourDe([{ id: 'a' }, { id: 'b' }]))
    expect(m.version).toBe(2)
    expect(m.scenes.map((e) => e.foto2048)).toEqual(['000.2k.jpg', '001.2k.jpg'])
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

  it('lleva el rumbo, el nivel y la cobertura de cada habitacion', () => {
    /* Sin esto la brujula del comprador diria "frente" en una casa que si sabe
       donde esta el norte, y el horizonte que el agente enderezo llegaria
       torcido. */
    const m = armarManifiesto(
      tourDe([{ id: 'a', rumbo: 70, nivel: { tiltX: 2, tiltZ: -1.5 }, coverageDeg: 358 }, { id: 'b' }]),
    )
    expect(m.scenes[0]).toMatchObject({ rumbo: 70, nivel: { tiltX: 2, tiltZ: -1.5 }, coverageDeg: 358 })
    expect(m.scenes[1].rumbo).toBeUndefined()
    expect(m.scenes[1].nivel).toBeUndefined()
  })

  it('lleva la ficha, la marca sin su logoId, y el logo con el nombre que le dan', () => {
    /* `logoId` es una llave de IndexedDB de ESTE telefono: en el servidor no
       significa nada. El logo va como archivo, y su nombre lo decide quien lo
       sube porque depende del tipo del blob. */
    const tour = tourDe([{ id: 'a' }], {
      ficha: { precio: 'Desde $1.9M', direccion: 'Av. Vallarta 1234' },
      marca: { nombre: 'Del Valle', colores: { brand500: '#7c3aed' }, hudTinta: '#f8fafc', logoId: 'img-local' },
      autogiro: true,
    })
    const m = armarManifiesto(tour, { logo: 'logo.png' })
    expect(m.ficha).toEqual({ precio: 'Desde $1.9M', direccion: 'Av. Vallarta 1234' })
    expect(m.marca).toMatchObject({ nombre: 'Del Valle', colores: { brand500: '#7c3aed' }, hudTinta: '#f8fafc', logo: 'logo.png' })
    expect(m.marca && 'logoId' in m.marca).toBe(false)
    expect(m.autogiro).toBe(true)
  })

  it('sin ficha, marca ni kiosco, no inventa los campos', () => {
    const m = armarManifiesto(tourDe([{ id: 'a' }]))
    expect(m.ficha).toBeUndefined()
    expect(m.marca).toBeUndefined()
    expect(m.autogiro).toBeUndefined()
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

  const v2 = {
    version: 2,
    title: 'Casa de prueba',
    startSceneId: 'a',
    scenes: [
      {
        id: 'a',
        name: 'Sala',
        foto: '000.jpg',
        foto2048: '000.2k.jpg',
        initialYaw: '90',
        hotspots: [],
        rumbo: 400,
        nivel: { tiltX: 3, tiltZ: 40 },
      },
      { id: 'b', name: 'Patio', foto: '001.jpg', initialYaw: 0, hotspots: [] },
    ],
    ficha: { precio: 'Desde $1.9M', agente: { correo: 'ana@valle.mx?bcc=espia@mal.mx' } },
    marca: {
      nombre: 'Del Valle',
      /* brand600 va junto con brand500 a proposito: `revisarPaleta` valida la
         paleta como CONJUNTO, y un 500 violeta con el 600 ambar del tema base
         deja la tinta del boton presionado ilegible. Es el mismo criterio que
         aplica al `.tour`. */
      colores: { brand500: '#7c3aed', brand600: '#6d28d9', ink50: '#fff;} html{filter:invert(1)}' },
      hudTinta: '#f8fafc',
      logo: 'logo.png',
    },
    autogiro: true,
  }

  it('elige la variante de 2048 solo en un aparato que sube texturas a 2048', () => {
    /* Es el ahorro entero de la variante: 1.1 MB menos por cuarto en el
       telefono que menos datos tiene. Y en uno normal, la completa, porque ahi
       si se ve la diferencia. */
    const normal = manifiestoATour(llave, v2)
    const modesto = manifiestoATour(llave, v2, { anchoTextura: 2048 })
    expect(normal.scenes[0].image).toContain('/fotos/000.jpg')
    expect(modesto.scenes[0].image).toContain('/fotos/000.2k.jpg')
    // La segunda habitacion no trae variante: la completa, en los dos.
    expect(modesto.scenes[1].image).toContain('/fotos/001.jpg')
  })

  it('pasa la ficha y la marca por los MISMOS filtros que un .tour ajeno', () => {
    /* Un manifiesto publicado tambien es de una red que no se controla. El
       correo con un BCC escondido y la inyeccion de CSS son los dos casos que ya
       cazo el importador; aqui tienen que caer igual. */
    const tour = manifiestoATour(llave, v2)
    expect(tour.ficha?.precio).toBe('Desde $1.9M')
    expect(tour.ficha?.agente?.correo).toBeUndefined()
    expect(tour.marca?.nombre).toBe('Del Valle')
    expect(tour.marca?.colores?.brand500).toBe('#7c3aed')
    expect(tour.marca?.colores?.ink50).toBeUndefined()
    expect(tour.marca?.hudTinta).toBe('#f8fafc')
    expect(tour.marca?.logo).toContain(`/t/${llave}/fotos/logo.png`)
    expect(tour.autogiro).toBe(true)
  })

  it('y las habitaciones por el filtro de las escenas: yaw de texto, rumbo al circulo, nivel acotado', () => {
    const tour = manifiestoATour(llave, v2)
    expect(tour.scenes[0].initialYaw).toBe(90)
    expect(tour.scenes[0].rumbo).toBe(40)
    expect(tour.scenes[0].nivel).toEqual({ tiltX: 3, tiltZ: 15 })
    expect(tour.scenes[1].rumbo).toBeUndefined()
  })

  it('un logo con nombre fuera de la lista no llega', () => {
    const tour = manifiestoATour(llave, { ...v2, marca: { ...v2.marca, logo: 'logo.svg' } })
    expect(tour.marca?.logo).toBeUndefined()
  })
})

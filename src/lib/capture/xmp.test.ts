import { describe, expect, it } from 'vitest'

import { leerGPano } from './importar'
import { conGPano, insertarXMP, paqueteGPano, puntoDeInsercion, XmpError } from './xmp'
import type { Bytes } from '../store/zip'

/**
 * ============================================================================
 *  QUE EL JPEG SIGA SIENDO UN JPEG
 * ============================================================================
 *
 * Este archivo mete bytes en medio de un archivo binario ajeno. Si el recorrido
 * de marcadores se equivoca por dos bytes, el resultado no da error: da una
 * panorámica que ya no abre en ningún lado, y el usuario se entera cuando
 * intenta enseñar la casa.
 *
 * Por eso la prueba no usa un JPEG inventado a mano sino uno de verdad, salido
 * de un codificador de verdad (libjpeg): una imagen de 32×16 con textura,
 * guardada al 55 % de calidad y pegada aquí en base64. Son 835 bytes, con su
 * APP0/JFIF, sus dos tablas de cuantización, sus cuatro de Huffman y su trama.
 * Va incrustada y no leída del disco a propósito: una prueba que abre un archivo
 * del proyecto se cae el día que alguien mueve la carpeta, y además `node:fs` no
 * existe en el `tsconfig.app.json` de la app, que es el que revisa todo `src`.
 *
 * De ese archivo se derivan las tres formas que importan:
 *
 *   · tal cual, que empieza con un APP0/JFIF;
 *   · sin el APP0, que es legal y es EXACTAMENTE el caso donde se rompe quien
 *     calcula la posición como `4 + getUint16(4)`;
 *   · con un APP1/Exif por delante, para comprobar que el nuestro va después y
 *     no en medio del ajeno.
 *
 * Lo que NO se puede probar aquí es decodificar la imagen resultante: las
 * pruebas corren en Node, sin canvas y sin `createImageBitmap`. El sustituto es
 * más estricto de lo que parece: se vuelve a recorrer el archivo marcador por
 * marcador, se leen ancho y alto del SOF y se comprueba que ni un solo byte de
 * los originales cambió de valor ni de orden. Un decodificador que se atragante
 * con eso tendría que atragantarse también con el archivo original.
 *
 * La última prueba es la que le da sentido a todo el módulo: lo que escribimos
 * lo tiene que poder leer `leerGPano()`, que es el lector que ya teníamos. Ese
 * era el agujero —exportábamos algo que ni nosotros mismos reconocíamos.
 */

const FIXTURE_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA4KCw0LCQ4NDA0QDw4RFiQXFhQUFiwgIRokNC43NjMuMjI6QVNGOj1OPj' +
  'IySGJJTlZYXV5dOEVmbWVabFNbXVn/2wBDAQ8QEBYTFioXFypZOzI7WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZ' +
  'WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVn/wAARCAAQACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAw' +
  'QFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkK' +
  'FhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmq' +
  'KjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEB' +
  'AQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRob' +
  'HBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOE' +
  'hYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+P' +
  'n6/9oADAMBAAIRAxEAPwCrElvaHyrWIXMuPvA/IOPXv24H51ca2ZwsmpXASPOVj6Dr2UdcZ68mnx72YR6bHtXvK6cn' +
  'nsPT6+vamPJZWMjea7Xl50KKdxyMj5m7dMeo9KmrjatefLTTcvx/yRVPCQpLnqO35/8AAJIBc3H7u0i+zxHjd1cjnv' +
  '27dOfeonubK0Di2P227bncPmQMcHLN369s9McVBcm4vFZ7yYW1nn5YQcL64Pdjxn69AKdA3/LPT7f282QfXoPyPP5V' +
  'ccDFe/iZX8lt85dfRfeyZYxu8cNGy7n/2Q=='

/** base64 → bytes. `atob` es de siempre en el navegador y global en Node. */
function debase64(texto: string): Bytes {
  const binario = atob(texto)
  const salida = new Uint8Array(binario.length) as Bytes
  for (let i = 0; i < binario.length; i++) salida[i] = binario.charCodeAt(i)
  return salida
}

const JPEG = debase64(FIXTURE_B64)

/** Recorre los segmentos hasta el SOS, que es donde empiezan los datos crudos. */
function segmentos(bytes: Uint8Array): Array<{ marcador: number; inicio: number; largo: number }> {
  const lista: Array<{ marcador: number; inicio: number; largo: number }> = []
  let i = 2
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error(`Marcador roto en la posición ${i}.`)
    const marcador = bytes[i + 1]
    const largo = (bytes[i + 2] << 8) | bytes[i + 3]
    lista.push({ marcador, inicio: i, largo })
    if (marcador === 0xda) break
    i += 2 + largo
  }
  return lista
}

/** Ancho y alto declarados en la trama. Es lo que lee un decodificador. */
function dimensiones(bytes: Uint8Array): { ancho: number; alto: number } {
  for (const { marcador, inicio } of segmentos(bytes)) {
    // SOF0…SOF15 son C0…CF menos C4 (tablas Huffman), C8 (reservado) y CC (aritmética).
    const esSOF =
      marcador >= 0xc0 &&
      marcador <= 0xcf &&
      marcador !== 0xc4 &&
      marcador !== 0xc8 &&
      marcador !== 0xcc
    if (!esSOF) continue
    return {
      alto: (bytes[inicio + 5] << 8) | bytes[inicio + 6],
      ancho: (bytes[inicio + 7] << 8) | bytes[inicio + 8],
    }
  }
  throw new Error('El archivo no tiene marcador de trama.')
}

/** El mismo JPEG sin su APP0/JFIF: un archivo que arranca directo en DQT. */
function sinAPP0(bytes: Bytes): Bytes {
  const largo = (bytes[2 + 2] << 8) | bytes[2 + 3]
  expect(bytes[3]).toBe(0xe0)
  const salida = new Uint8Array(bytes.length - (2 + largo)) as Bytes
  salida.set(bytes.subarray(0, 2), 0)
  salida.set(bytes.subarray(2 + 2 + largo), 2)
  return salida
}

/** El mismo JPEG con un APP1/Exif de mentiras metido antes del APP0. */
function conExif(bytes: Bytes): Bytes {
  const cuerpo = new TextEncoder().encode('Exif\0\0MM\0*\0\0\0\b\0\0')
  const largo = 2 + cuerpo.length
  const salida = new Uint8Array(bytes.length + 2 + largo) as Bytes
  salida.set(bytes.subarray(0, 2), 0)
  salida[2] = 0xff
  salida[3] = 0xe1
  salida[4] = (largo >> 8) & 0xff
  salida[5] = largo & 0xff
  salida.set(cuerpo, 6)
  salida.set(bytes.subarray(2), 2 + 2 + largo)
  return salida
}

const OPCIONES = { ancho: 4096, alto: 2048, norte: 137.5, tomas: 26, exposicionFijada: true }

describe('paqueteGPano', () => {
  it('escribe los campos que hacen que un visor cambie a modo esfera', () => {
    const xml = paqueteGPano({ ancho: 4096, alto: 2048 })
    expect(xml).toContain('xmlns:GPano="http://ns.google.com/photos/1.0/panorama/"')
    expect(xml).toContain('GPano:UsePanoramaViewer="True"')
    expect(xml).toContain('GPano:ProjectionType="equirectangular"')
    expect(xml).toContain('GPano:FullPanoWidthPixels="4096"')
    expect(xml).toContain('GPano:FullPanoHeightPixels="2048"')
    expect(xml).toContain('GPano:CroppedAreaImageWidthPixels="4096"')
    expect(xml).toContain('GPano:CroppedAreaImageHeightPixels="2048"')
    expect(xml).toContain('GPano:CroppedAreaLeftPixels="0"')
    expect(xml).toContain('GPano:CroppedAreaTopPixels="0"')
  })

  /* El norte es opcional de verdad: un iPhone sin permiso de sensores, o una
     captura hecha entera con la pantalla en horizontal, deja `offsetNorte` en
     null. Escribir "null" o un 0 inventado sería peor que callarse: un 0 dice
     "esto mira al norte" y es mentira. */
  it('sin norte no inventa un rumbo', () => {
    const xml = paqueteGPano({ ancho: 4096, alto: 2048, norte: null })
    expect(xml).not.toContain('PoseHeadingDegrees')
    expect(paqueteGPano({ ancho: 4096, alto: 2048, norte: Number.NaN })).not.toContain(
      'PoseHeadingDegrees',
    )
  })

  /* GPano define el rumbo en [0, 360). El tracker entrega el offset ya
     envuelto a ±180, así que los negativos son el caso NORMAL, no el raro. */
  it('normaliza el rumbo a [0, 360)', () => {
    const rumbo = (norte: number) =>
      /PoseHeadingDegrees="([^"]+)"/.exec(paqueteGPano({ ancho: 8, alto: 4, norte }))?.[1]
    expect(rumbo(-90)).toBe('270')
    expect(rumbo(0)).toBe('0')
    expect(rumbo(137.456)).toBe('137.46')
    expect(rumbo(720.5)).toBe('0.5')
    // 359.999 redondeado a dos decimales daría 360, que está fuera del rango.
    expect(rumbo(359.999)).toBe('0')
  })

  it('el conteo de tomas y el bloqueo de exposición solo salen si los hay', () => {
    const completo = paqueteGPano(OPCIONES)
    expect(completo).toContain('GPano:SourcePhotosCount="26"')
    expect(completo).toContain('GPano:ExposureLockUsed="True"')
    expect(completo).toContain('GPano:PoseHeadingDegrees="137.5"')

    const pelado = paqueteGPano({ ancho: 4096, alto: 2048, tomas: 0, exposicionFijada: null })
    expect(pelado).not.toContain('SourcePhotosCount')
    expect(pelado).not.toContain('ExposureLockUsed')
  })

  /* Un nombre con comillas partiría el atributo y dejaría el XML mal formado,
     que para un lector estricto es lo mismo que no tener metadatos. */
  it('escapa el texto que viene de fuera', () => {
    const xml = paqueteGPano({ ancho: 8, alto: 4, programaDeCaptura: 'Cámara "A" & <b>' })
    expect(xml).toContain('GPano:CaptureSoftware="Cámara &quot;A&quot; &amp; &lt;b&gt;"')
  })

  it('no arma metadatos con dimensiones imposibles', () => {
    for (const ancho of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 300_000]) {
      expect(() => paqueteGPano({ ancho, alto: 2048 })).toThrow(XmpError)
    }
    expect(() => paqueteGPano({ ancho: 4096, alto: 0 })).toThrow(XmpError)
  })
})

describe('puntoDeInsercion', () => {
  it('salta el APP0/JFIF usando su longitud real', () => {
    // El APP0 de este archivo mide 16 bytes de contenido: 2 (marcador) + 2
    // (longitud) + 16 = la posición 20.
    expect(puntoDeInsercion(JPEG)).toBe(20)
  })

  /* La razón de ser de todo el recorrido. Un JPEG sin APP0 es legal, y quien
     calcula la posición como `4 + getUint16(4)` aquí escribiría dentro de la
     tabla de cuantización: 4 + 67 = 71, en medio del segundo DQT. */
  it('sin APP0 inserta justo después del SOI', () => {
    expect(puntoDeInsercion(sinAPP0(JPEG))).toBe(2)
  })

  it('con un Exif por delante inserta después de los dos', () => {
    const bytes = conExif(JPEG)
    // 2 (SOI) + el Exif de mentiras + el APP0 de siempre.
    expect(puntoDeInsercion(bytes)).toBe(2 + 2 + 18 + 2 + 16)
  })

  it('no toca lo que no es un JPEG', () => {
    expect(puntoDeInsercion(new Uint8Array([0x89, 0x50, 0x4e, 0x47]) as Bytes)).toBeNull()
    expect(puntoDeInsercion(new Uint8Array([0xff, 0xd8]) as Bytes)).toBeNull()
    expect(puntoDeInsercion(new Uint8Array(0) as Bytes)).toBeNull()
  })

  /* Una longitud que se sale del archivo significa que está truncado. Seguir
     saltando con ella es leer memoria que no es del segmento. */
  it('no toca un archivo con una longitud imposible', () => {
    const roto = JPEG.slice(0, 40) as Bytes
    roto[4] = 0xff
    roto[5] = 0xf0
    expect(puntoDeInsercion(roto)).toBeNull()
  })
})

describe('insertarXMP', () => {
  it('deja el JPEG legible y con las mismas dimensiones', () => {
    const antes = dimensiones(JPEG)
    const salida = insertarXMP(JPEG, paqueteGPano({ ...OPCIONES, ...antes }))

    expect(salida.length).toBeGreaterThan(JPEG.length)
    expect(dimensiones(salida)).toEqual(antes)

    // El segmento nuevo es un APP1 y está donde se pidió.
    const lista = segmentos(salida)
    expect(lista[0].marcador).toBe(0xe0)
    expect(lista[1].marcador).toBe(0xe1)
    expect(lista[1].inicio).toBe(20)
    // La longitud declarada tiene que cubrir el segmento entero menos su marcador.
    expect(lista[2].inicio).toBe(20 + 2 + lista[1].largo)

    // Y todos los bytes viejos siguen ahí, en el mismo orden: el archivo
    // entero, partido en el punto de inserción, sin una sola diferencia.
    const crecio = salida.length - JPEG.length
    expect(Array.from(salida.subarray(0, 20))).toEqual(Array.from(JPEG.subarray(0, 20)))
    expect(Array.from(salida.subarray(20 + crecio))).toEqual(Array.from(JPEG.subarray(20)))
  })

  it('también deja legible el que no traía APP0', () => {
    const base = sinAPP0(JPEG)
    const salida = insertarXMP(base, paqueteGPano({ ancho: 4096, alto: 2048 }))
    expect(dimensiones(salida)).toEqual(dimensiones(base))
    expect(segmentos(salida)[0].marcador).toBe(0xe1)
  })

  /* Insertar dos veces dejaría dos paquetes XMP, y cada lector elige uno
     distinto. Mejor que la segunda vez no haga nada. */
  it('no escribe un segundo paquete si ya hay uno', () => {
    const una = insertarXMP(JPEG, paqueteGPano(OPCIONES))
    const dos = insertarXMP(una, paqueteGPano(OPCIONES))
    expect(dos).toBe(una)
  })

  it('devuelve el original si no hay dónde insertar', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) as Bytes
    expect(insertarXMP(png, paqueteGPano({ ancho: 8, alto: 4 }))).toBe(png)
  })
})

describe('conGPano', () => {
  /* La prueba que cierra el ciclo: `leerGPano()` es el lector que ya teníamos
     para las fotos de Google y de las cámaras 360, y hasta hoy no reconocía lo
     que exportábamos nosotros. */
  it('lo que escribimos lo lee nuestro propio leerGPano', async () => {
    const jpeg = new Blob([JPEG], { type: 'image/jpeg' })
    const salida = await conGPano(jpeg, { ancho: 4096, alto: 2048, norte: 137.5, tomas: 26 })

    expect(salida.size).toBeGreaterThan(jpeg.size)
    expect(salida.type).toBe('image/jpeg')
    expect(await leerGPano(salida)).toEqual({
      anchoTotal: 4096,
      altoTotal: 2048,
      ancho: 4096,
      alto: 2048,
      izquierda: 0,
      arriba: 0,
    })
  })

  /* La guarda que importa de verdad: si algo sale mal, la app se queda con la
     foto de ayer, no sin foto. Aquí lo que sale mal es que el blob no es un
     JPEG y que las dimensiones son absurdas. */
  it('ante cualquier problema devuelve el mismo blob', async () => {
    const noEsJpeg = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
    expect(await conGPano(noEsJpeg, { ancho: 4096, alto: 2048 })).toBe(noEsJpeg)

    const jpeg = new Blob([JPEG], { type: 'image/jpeg' })
    expect(await conGPano(jpeg, { ancho: 0, alto: 0 })).toBe(jpeg)
  })
})

import { describe, expect, it } from 'vitest'

import { createZip, nombreSeguro, readZip, type Bytes, type ZipEntry } from './zip'

/**
 * ============================================================================
 *  EL .TOUR QUE LLEGA POR WHATSAPP
 * ============================================================================
 *
 * De todas las pruebas del proyecto, esta es la única que cubre algo que un
 * desconocido puede provocar a propósito. Las demás son cuentas de geometría
 * que salen bien o mal solas; aquí quien decide qué bytes entran es quien mandó
 * el archivo.
 *
 * Así que se revisan dos cosas distintas:
 *
 *   · que un recorrido exportado se pueda volver a abrir tal cual, con los
 *     acentos y las fotos grandes intactos;
 *   · que un nombre de archivo que intenta salirse de su carpeta se caiga en el
 *     filtro y no en la carpeta de al lado.
 */

const texto = (s: string): Bytes => new TextEncoder().encode(s) as Bytes

/** Bytes reproducibles y sin patrón obvio, para que un error de copia se note. */
function relleno(largo: number): Bytes {
  const salida = new Uint8Array(largo) as Bytes
  let estado = 0x2f6e2b1
  for (let i = 0; i < largo; i++) {
    estado = (estado * 1103515245 + 12345) & 0x7fffffff
    salida[i] = (estado >>> 16) & 0xff
  }
  return salida
}

function mismosBytes(a: Bytes, b: Bytes) {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) throw new Error(`Los bytes cambiaron en la posición ${i}.`)
  }
}

describe('createZip → readZip', () => {
  /* La foto pasa de los 64 kB a propósito: por debajo de ese tamaño el archivo
     entero cabe en un trozo y el lector nunca da más de una vuelta. Las
     panorámicas de verdad pesan megabytes, así que el camino que importa es
     este y no el del manifiesto de dos renglones. */
  it('devuelve las mismas entradas, con acentos y con una foto grande', async () => {
    const manifiesto = texto(
      JSON.stringify({ titulo: 'Casa en Tlajomulco — recámara y jardín', habitaciones: 3 }),
    )

    const entradas: ZipEntry[] = [
      { name: 'recorrido.json', data: manifiesto },
      { name: 'fotos/000-recámara-señora-ñ.jpg', data: relleno(200_000) },
      { name: 'fotos/000.min.jpg', data: relleno(4096) },
    ]

    const leidas = await readZip(createZip(entradas))

    expect(leidas.map((f) => f.name)).toEqual(entradas.map((e) => e.name))
    for (let i = 0; i < entradas.length; i++) mismosBytes(leidas[i].data, entradas[i].data)
  })

  /* La fecha fija de las entradas existe para esto. Si alguien la cambia por
     `new Date()`, exportar el mismo recorrido dos veces deja de dar el mismo
     archivo y comparar dos exportaciones deja de significar nada. */
  it('exportar dos veces lo mismo da los mismos bytes', async () => {
    const entradas: ZipEntry[] = [{ name: 'recorrido.json', data: texto('{"a":1}') }]
    const a = new Uint8Array(await createZip(entradas).arrayBuffer())
    const b = new Uint8Array(await createZip(entradas).arrayBuffer())
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('aguanta un archivo vacío y uno de un solo byte', async () => {
    const entradas: ZipEntry[] = [
      { name: 'vacio.txt', data: new Uint8Array(0) as Bytes },
      { name: 'uno.bin', data: new Uint8Array([0xff]) as Bytes },
    ]
    const leidas = await readZip(createZip(entradas))
    expect(leidas.map((f) => f.name)).toEqual(['vacio.txt', 'uno.bin'])
    expect(leidas[0].data.length).toBe(0)
    expect(leidas[1].data[0]).toBe(0xff)
  })

  it('no confunde un archivo cualquiera con un ZIP', async () => {
    await expect(readZip(new Blob([texto('esto no es un zip')]))).rejects.toThrow(
      /no parece un ZIP/,
    )
  })

  /* El filtro no vive en `createZip` sino en `readZip`, que es por donde entra
     lo ajeno. Por eso el zip malicioso se fabrica con nuestro propio escritor:
     es la forma más corta de armar bytes válidos con nombres inválidos dentro.
     Que `createZip` los acepte no importa — nadie exporta con esos nombres. */
  it('descarta al leer las entradas cuyo nombre se sale de su carpeta', async () => {
    const leidas = await readZip(
      createZip([
        { name: '../../robado.txt', data: texto('no') },
        { name: 'fotos/000.jpg', data: texto('sí') },
        { name: '/etc/passwd', data: texto('no') },
        { name: 'fotos\\000.jpg', data: texto('no') },
      ]),
    )
    expect(leidas.map((f) => f.name)).toEqual(['fotos/000.jpg'])
  })
})

describe('nombreSeguro', () => {
  /* Los nombres con contrabarra se rechazan enteros y no solo cuando apuntan
     hacia arriba: en Windows la contrabarra TAMBIÉN separa carpetas, así que
     "fotos\..\x" se salta la revisión de "..", que solo mira los pedazos
     partidos por diagonal. */
  const casos: Array<[string, boolean]> = [
    ['recorrido.json', true],
    ['fotos/000.jpg', true],
    ['fotos/000.min.jpg', true],
    ['fotos/recámara-ñ.jpg', true],
    ['x'.repeat(255), true],
    ['../x', false],
    ['/x', false],
    ['a\\b', false],
    ['a/../b', false],
    ['./x', false],
    ['a/./b', false],
    ['..', false],
    ['', false],
    ['a\u0000b', false],
    ['a\u001fb', false],
    ['x'.repeat(256), false],
  ]

  for (const [nombre, esperado] of casos) {
    it(`${JSON.stringify(nombre).slice(0, 40)} → ${esperado}`, () => {
      expect(nombreSeguro(nombre)).toBe(esperado)
    })
  }
})

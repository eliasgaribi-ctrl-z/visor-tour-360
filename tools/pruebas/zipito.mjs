/**
 * ============================================================================
 *  UN ESCRITOR DE ZIP DE JUGUETE, A PROPÓSITO INDEPENDIENTE DEL DEL PROYECTO
 * ============================================================================
 *
 * Sirve para fabricar los archivos `.tour` de prueba: los buenos y los hostiles.
 *
 * ── Por qué no se usa `src/lib/store/zip.ts` ──────────────────────────────
 *
 * Porque un arnés que arma el archivo con el MISMO código que lo va a leer no
 * prueba el formato: prueba que una función se entiende consigo misma. Si
 * `createZip` y `readZip` compartieran un error de interpretación —un offset,
 * un orden de bytes— la prueba pasaría igual y el `.tour` no lo abriría ningún
 * otro descompresor. Es la misma lección que dejaron `damp.mjs` y
 * `contraste.mjs` al revés: ahí el arnés reimplementaba lo que probaba y por eso
 * no probaba nada. Aquí la independencia es justo lo que se busca.
 *
 * Solo escribe entradas SIN COMPRIMIR (método 0), que es lo único que el
 * proyecto produce y lo único que su lector entiende. Y se verifica contra un
 * tercero de verdad: `zipfile` de Python abre lo que sale de aquí (ver el
 * comentario al final del archivo).
 */

const FECHA = { hora: 0x5000, dia: 0x5a42 } // 2025-02-02 10:00, fija y sin sorpresas

/** CRC-32 tal como lo pide el formato ZIP. Tabla armada al cargar el módulo. */
const TABLA = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(datos) {
  let c = 0xffffffff
  for (let i = 0; i < datos.length; i++) c = TABLA[(c ^ datos[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * @param {{ name: string, data: Uint8Array }[]} entradas
 * @returns {Buffer} el ZIP completo
 */
export function zipito(entradas) {
  const locales = []
  const centrales = []
  let offset = 0

  for (const entrada of entradas) {
    const nombre = Buffer.from(entrada.name, 'utf8')
    const datos = Buffer.from(entrada.data)
    const suma = crc32(datos)

    const local = Buffer.alloc(30 + nombre.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // versión mínima
    local.writeUInt16LE(0, 6) // banderas
    local.writeUInt16LE(0, 8) // método: sin comprimir
    local.writeUInt16LE(FECHA.hora, 10)
    local.writeUInt16LE(FECHA.dia, 12)
    local.writeUInt32LE(suma, 14)
    local.writeUInt32LE(datos.length, 18)
    local.writeUInt32LE(datos.length, 22)
    local.writeUInt16LE(nombre.length, 26)
    local.writeUInt16LE(0, 28) // extra
    nombre.copy(local, 30)
    locales.push(local, datos)

    const central = Buffer.alloc(46 + nombre.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // versión de quien lo hizo
    central.writeUInt16LE(20, 6) // versión mínima
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(FECHA.hora, 12)
    central.writeUInt16LE(FECHA.dia, 14)
    central.writeUInt32LE(suma, 16)
    central.writeUInt32LE(datos.length, 20)
    central.writeUInt32LE(datos.length, 24)
    central.writeUInt16LE(nombre.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comentario
    central.writeUInt16LE(0, 34) // disco
    central.writeUInt16LE(0, 36) // atributos internos
    central.writeUInt32LE(0, 38) // atributos externos
    central.writeUInt32LE(offset, 42)
    nombre.copy(central, 46)
    centrales.push(central)

    offset += local.length + datos.length
  }

  const directorio = Buffer.concat(centrales)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(0, 4) // este disco
  fin.writeUInt16LE(0, 6) // disco del directorio
  fin.writeUInt16LE(entradas.length, 8)
  fin.writeUInt16LE(entradas.length, 10)
  fin.writeUInt32LE(directorio.length, 12)
  fin.writeUInt32LE(offset, 16)
  fin.writeUInt16LE(0, 20) // comentario

  return Buffer.concat([...locales, directorio, fin])
}

/** Atajo: un `.tour` con su manifiesto y las fotos que se le pasen. */
export function tourito(manifiesto, fotos = []) {
  return zipito([
    { name: 'recorrido.json', data: Buffer.from(JSON.stringify(manifiesto, null, 2), 'utf8') },
    ...fotos,
  ])
}

/* Comprobado contra un lector de verdad, no contra este archivo:
 *
 *   node -e "import('./tools/pruebas/zipito.mjs').then(m => \
 *     require('fs').writeFileSync('/tmp/z.zip', m.zipito([{name:'a.txt', \
 *     data:Buffer.from('hola')}])))" \
 *   && python3 -c "import zipfile; z=zipfile.ZipFile('/tmp/z.zip'); \
 *      print(z.testzip(), z.read('a.txt'))"
 *
 * Tiene que imprimir `None b'hola'`: None significa que ningún CRC está mal.
 */

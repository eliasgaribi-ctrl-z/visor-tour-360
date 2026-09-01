/**
 * ============================================================================
 *  ZIP MÍNIMO, ESCRITO A MANO
 * ============================================================================
 *
 * El archivo `.tour` que se exporta es un ZIP normal (se puede abrir con
 * cualquier descompresor) con esta forma:
 *
 *   recorrido.json          el manifiesto: título, habitaciones, hotspots
 *   fotos/img_xxxx.jpg      una equirectangular por habitación
 *   fotos/img_xxxx.thumb.jpg
 *
 * Se escribe SIN COMPRIMIR (método "store"). No es pereza: los JPEG ya están
 * comprimidos y volver a pasarlos por deflate los deja del mismo tamaño
 * gastando segundos de CPU del teléfono. El manifiesto es texto y sí se
 * comprimiría bien, pero pesa unos pocos KB.
 *
 * Al LEER sí se acepta deflate, por si alguien vuelve a empaquetar el archivo
 * con otra herramienta: se descomprime con DecompressionStream('deflate-raw'),
 * que existe en Chrome/Edge 103+, Safari 16.4+ y Firefox 113+.
 *
 * Referencia del formato: APPNOTE.TXT de PKWARE, secciones 4.3.7 (cabecera
 * local), 4.3.12 (directorio central) y 4.3.16 (fin del directorio central).
 * Todos los enteros van en little endian.
 */

/* ------------------------------------------------------------------- CRC-32 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Bytes): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/* -------------------------------------------------------- FECHA ESTILO DOS */

/** El ZIP guarda la fecha en el formato de MS-DOS: 7 bits de año desde 1980. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/* ------------------------------------------------------------------ ESCRIBIR */

/**
 * `Uint8Array<ArrayBuffer>` y no `Uint8Array` a secas: en TypeScript 6 el tipo
 * genérico incluye SharedArrayBuffer, y un Blob no acepta memoria compartida.
 */
export type Bytes = Uint8Array<ArrayBuffer>

export type ZipEntry = {
  /** Ruta dentro del zip, con / como separador. */
  name: string
  data: Bytes
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
/** Bit 11 del flag: el nombre del archivo va en UTF-8. */
const FLAG_UTF8 = 0x0800

/**
 * Fecha fija en todas las entradas.
 *
 * Así, exportar dos veces el mismo recorrido produce bytes idénticos, que es lo
 * que permite compararlos en una prueba. La fecha de verdad va en el manifiesto,
 * que es donde sirve de algo; el campo del ZIP solo se ve en el listado del
 * descompresor.
 */
const FECHA_FIJA = new Date(2026, 0, 1, 12, 0, 0)

const MAX_ENTRADAS = 0xffff
const MAX_BYTES = 0xffffffff

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

export function createZip(entries: ZipEntry[], modified = FECHA_FIJA): Blob {
  /* Sin ZIP64 no caben más de 65 535 entradas ni desplazamientos por encima de
     4 GB. Un recorrido de 40 habitaciones con panorámicas de 6 MB son 240 MB,
     o sea que esto no debería pasar nunca; pero si pasara, un ZIP con los
     campos desbordados se ve bien hasta que alguien intenta abrirlo. */
  if (entries.length > MAX_ENTRADAS) {
    throw new ZipError('El recorrido tiene demasiados archivos para exportarse.')
  }
  const { time, date } = dosDateTime(modified)
  const encoder = new TextEncoder()

  const parts: Bytes[] = []
  const central: Bytes[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    /* Cabecera local: 30 bytes fijos + el nombre. */
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, SIG_LOCAL, true)
    lv.setUint16(4, 20, true) // versión necesaria para extraer: 2.0
    lv.setUint16(6, FLAG_UTF8, true)
    lv.setUint16(8, 0, true) // método 0 = store
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true) // tamaño comprimido
    lv.setUint32(22, size, true) // tamaño original
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true) // sin campo extra
    local.set(name, 30)

    parts.push(local, entry.data)

    /* Entrada del directorio central: 46 bytes fijos + el nombre. */
    const dir = new Uint8Array(46 + name.length)
    const dv = new DataView(dir.buffer)
    dv.setUint32(0, SIG_CENTRAL, true)
    dv.setUint16(4, 20, true) // versión con la que se creó
    dv.setUint16(6, 20, true) // versión necesaria
    dv.setUint16(8, FLAG_UTF8, true)
    dv.setUint16(10, 0, true)
    dv.setUint16(12, time, true)
    dv.setUint16(14, date, true)
    dv.setUint32(16, crc, true)
    dv.setUint32(20, size, true)
    dv.setUint32(24, size, true)
    dv.setUint16(28, name.length, true)
    dv.setUint16(30, 0, true) // extra
    dv.setUint16(32, 0, true) // comentario
    dv.setUint16(34, 0, true) // disco
    dv.setUint16(36, 0, true) // atributos internos
    dv.setUint32(38, 0, true) // atributos externos
    dv.setUint32(42, offset, true) // dónde empieza la cabecera local
    dir.set(name, 46)
    central.push(dir)

    offset += local.length + size
    if (offset > MAX_BYTES) {
      throw new ZipError('El recorrido es demasiado grande para exportarse en un solo archivo.')
    }
  }

  const centralSize = central.reduce((total, d) => total + d.length, 0)

  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, SIG_EOCD, true)
  ev.setUint16(4, 0, true) // número de disco
  ev.setUint16(6, 0, true) // disco donde arranca el directorio
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true) // sin comentario

  return new Blob([...parts, ...central, eocd], { type: 'application/zip' })
}

/* -------------------------------------------------------------------- LEER */

export type ZipFile = { name: string; data: Bytes }

/** Rechaza rutas que se salen de su carpeta o traen caracteres raros. */
export function nombreSeguro(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false
  if (name.startsWith('/') || name.includes('\\')) return false
  if (name.split('/').some((parte) => parte === '..' || parte === '.')) return false
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f]/.test(name)
}

async function inflateRaw(data: Bytes): Promise<Bytes> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'Este archivo viene comprimido y el navegador no puede abrirlo. Actualiza el navegador o vuelve a exportarlo desde el visor.',
    )
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function readZip(blob: Blob): Promise<ZipFile[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(bytes.buffer)

  /* El fin del directorio central está al final, pero puede llevar hasta 64 KB
     de comentario detrás, así que se busca la firma hacia atrás. */
  let eocd = -1
  const limit = Math.max(0, bytes.length - 22 - 0xffff)
  for (let i = bytes.length - 22; i >= limit; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('El archivo no es un .tour válido (no parece un ZIP).')

  const count = view.getUint16(eocd + 10, true)
  let pointer = view.getUint32(eocd + 16, true)

  if (count === 0xffff || pointer === 0xffffffff) {
    throw new Error('El archivo usa ZIP64 y es demasiado grande para abrirlo aquí.')
  }

  const decoder = new TextDecoder()
  const files: ZipFile[] = []

  for (let i = 0; i < count; i++) {
    if (view.getUint32(pointer, true) !== SIG_CENTRAL) {
      throw new Error('El archivo .tour está dañado (directorio central ilegible).')
    }

    const method = view.getUint16(pointer + 10, true)
    const compressedSize = view.getUint32(pointer + 20, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    const localOffset = view.getUint32(pointer + 42, true)
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength))

    /* Los tamaños de nombre y extra de la cabecera LOCAL pueden diferir de los
       del directorio central, así que se releen ahí para saber dónde empiezan
       los datos. */
    if (view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Error(`El archivo .tour está dañado (cabecera de "${name}").`)
    }
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(start, start + compressedSize)

    /* Un .tour puede venir de cualquier lado, así que su contenido es dato
       ajeno: un nombre como "../../algo" no debe salirse de su lugar. Aquí
       nada se escribe al sistema de archivos —todo va a IndexedDB con ids que
       generamos nosotros— pero se filtra igual, porque el día que alguien
       agregue una descarga por archivo esto ya está resuelto. */
    if (!name.endsWith('/') && nombreSeguro(name)) {
      files.push({ name, data: method === 0 ? raw : await inflateRaw(raw) })
    }

    pointer += 46 + nameLength + extraLength + commentLength
  }

  return files
}

import { leerBytes } from '../store/bytes'
import { rumboDeEscena } from '../rumbo'
import type { Bytes } from '../store/zip'

/**
 * ============================================================================
 *  DECIRLE AL MUNDO QUE ESTO ES UNA PANORÁMICA (XMP / GPano)
 * ============================================================================
 *
 * Hasta ahora exportábamos JPEG mudos. La asimetría era rara: al IMPORTAR sí
 * leemos GPano —`leerGPano()` en ./importar.ts busca FullPanoWidthPixels,
 * CroppedAreaImageWidthPixels y compañía— pero al EXPORTAR no escribíamos ni un
 * byte de metadatos. O sea que la app no reconocía sus propias exportaciones:
 * exportabas un recorrido, volvías a meter el JPEG y `adivinarTipo()` tenía que
 * deducir por la proporción 2:1 lo que el archivo podría haber dicho de frente.
 *
 * Escribirlo cierra ese ciclo y, de paso, hace que la foto se abra sola en modo
 * esfera en Google Fotos, Facebook, Photo Sphere Viewer y Pannellum. Todos esos
 * buscan lo mismo: un bloque XMP con el espacio de nombres
 * http://ns.google.com/photos/1.0/panorama/.
 *
 * ── El dato que casi nadie tiene ────────────────────────────────────────────
 *
 * `GPano:PoseHeadingDegrees` es el rumbo de brújula del CENTRO de la imagen.
 * Casi ninguna panorámica de teléfono lo trae, porque hace falta fusionar el
 * giroscopio con el magnetómetro y quedarse con un número estable. Nosotros ya
 * lo hacemos: `OrientationTracker.offsetNorte` (./orientation.ts) es la mediana
 * de las primeras lecturas de `webkitCompassHeading` menos el yaw relativo del
 * giroscopio en ese mismo instante, o sea "cuántos grados hay que sumarle al
 * yaw para que 0 sea el norte".
 *
 * Y el centro de nuestras equirectangulares es exactamente yaw 0 DE LA
 * PANORÁMICA: el shader del costurero mapea `x ∈ [-1,1]` a yaw de -180° a 180°
 * (./stitcher.ts, FRAGMENT, comentario del paso 1), así que la columna del
 * medio es la dirección de la primera toma.
 *
 * Pero `offsetNorte` NO convierte el yaw de la panorámica: convierte el yaw
 * CRUDO del giroscopio, que es otra cosa. El costurero pega cada toma con
 * `Ry(baseYaw)·q`, y como `yaw(Ry(θ)·q) = yaw(q) − θ`, el yaw 0 de la
 * panorámica corresponde al yaw crudo `baseYaw` —el que tenía el teléfono al
 * empezar, o sea el cero arbitrario de `alpha` en iOS—. Hay que sumarlo:
 *
 *     rumbo del centro = baseYaw + offsetNorte
 *
 * Esa suma vive en `rumboDelCentro()`, aquí abajo, y no en quien llama, porque
 * escribirla mal no rompe nada visible: sale un rumbo con dos decimales de
 * falsa precisión que dice "al norte" apuntando a cualquier lado. Ya pasó una
 * vez. Si algún día parece que la suma sobra, la prueba de `xmp.test.ts` que
 * barre los ceros arbitrarios de `alpha` explica por qué no sobra.
 *
 * ── La trampa de la inserción ───────────────────────────────────────────────
 *
 * Un JPEG empieza con SOI (FF D8) y luego trae una cadena de segmentos, cada
 * uno con su longitud de dos bytes en big-endian. El XMP va en un APP1 (FF E1)
 * que hay que meter ANTES de los datos de imagen.
 *
 * La forma incorrecta —la que usa jpeg-xmp-writer y varios recortes que andan
 * por ahí— es calcular la posición como `4 + getUint16(4)`: eso da por hecho
 * que el primer segmento SIEMPRE es un APP0/JFIF. No es cierto. Un JPEG puede
 * empezar directo en DQT, o traer un APP1/Exif primero, y ahí ese cálculo
 * escribe el segmento en medio de otro y produce un archivo corrupto: no lanza
 * nada, simplemente deja de abrirse. Aquí se recorren los marcadores saltando
 * con su longitud real y se inserta después del último APPn, sea cual sea.
 *
 * Nada de esto lanza hacia afuera: `conGPano()` devuelve el JPEG original si
 * cualquier cosa sale mal. Perder los metadatos es un defecto; perder la foto
 * de una habitación que el usuario acaba de capturar, no.
 */

/** Marca de agua del paquete. Va en `x:xmptk` y en `GPano:StitchingSoftware`. */
const PROGRAMA = 'Visor Tour 360'

/**
 * La firma que identifica al APP1 como XMP, incluido su cero final.
 * Son 29 bytes y van pegados justo después de la longitud del segmento.
 */
const FIRMA_XMP = 'http://ns.adobe.com/xap/1.0/\0'

/**
 * Envoltura estándar del paquete. Lo que va dentro de `begin` no es un espacio:
 * es un U+FEFF, la marca de orden de bytes que le dice al lector que lo que
 * sigue viene en UTF-8. Se escribe con la secuencia de escape y no con el
 * carácter porque, pegado tal cual, es invisible: nadie lo vería en una
 * diferencia y cualquiera lo borraría al reacomodar la línea.
 */
const XPACKET_INICIO = '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>'
const XPACKET_FIN = '<?xpacket end="w"?>'

/**
 * Tope de un segmento JPEG. La longitud son dos bytes y se cuenta a sí misma,
 * así que el contenido no puede pasar de 65 533 bytes; descontando la firma nos
 * quedan 65 504 para el XML. Nuestro paquete anda en 1 kB, o sea que el tope no
 * se roza ni de lejos, pero si algún día alguien mete un texto largo aquí,
 * mejor que no escriba una longitud desbordada.
 */
const MAX_PAQUETE = 0xffff - 2 - FIRMA_XMP.length

/**
 * Mismo criterio de cordura que `leerGPano()` al importar: 200 000 píxeles de
 * lado es más del doble de la panorámica más grande de cualquier cámara de
 * consumo, y nosotros exportamos 4096 de ancho.
 */
const MAX_LADO = 200_000

export type OpcionesGPano = {
  /** Ancho en píxeles de la equirectangular que se está exportando. */
  ancho: number
  /** Alto en píxeles. En una esfera completa es la mitad del ancho. */
  alto: number
  /**
   * Rumbo de brújula del CENTRO de la imagen, en grados desde el norte.
   * Se calcula con `rumboDelCentro(baseYaw, offsetNorte)` — NO es `offsetNorte`
   * a secas, ver la cabecera de este archivo. Si vale `null` —teléfono sin
   * magnetómetro, permiso negado, o la captura entera hecha con la pantalla en
   * horizontal— el campo simplemente no se escribe, que es lo honesto.
   */
  norte?: number | null
  /** Cuántas fotos se cosieron. Va en `GPano:SourcePhotosCount`. */
  tomas?: number | null
  /** Lo que devolvió `fijarExposicion()`. Va en `GPano:ExposureLockUsed`. */
  exposicionFijada?: boolean | null
  /** Hacia dónde mira el visor al abrir, respecto al centro. Casi siempre 0. */
  vistaInicial?: number
  /** Con qué se tomaron las fotos. Por omisión, el nombre del programa. */
  programaDeCaptura?: string
}

/* ------------------------------------------------------------------ EL XML */

function escapar(texto: string): string {
  // El `&` va primero o se escaparían dos veces las entidades recién puestas.
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function esEnteroSano(valor: number): boolean {
  return Number.isFinite(valor) && Number.isInteger(valor) && valor > 0 && valor <= MAX_LADO
}

/** Grados normalizados a [0, 360) y con dos decimales, sin notación exponencial. */
function grados(valor: number): string {
  const vuelta = ((valor % 360) + 360) % 360
  const redondeado = Math.round(vuelta * 100) / 100
  // Un 359.999 redondea a 360, que el espectro de GPano NO admite: el rango es
  // [0, 360). Se devuelve 0, que es el mismo rumbo.
  return String(redondeado >= 360 ? 0 : redondeado)
}

export class XmpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XmpError'
  }
}

/**
 * Arma el XML de GPano. Devuelve el `<x:xmpmeta>` pelado: la envoltura
 * `<?xpacket …?>` la pone `insertarXMP`, que es quien conoce el formato del
 * segmento.
 *
 * Los campos y sus nombres salen de la tabla de exiftool
 * (lib/Image/ExifTool/Google.pm). Los recortados y los totales valen lo mismo
 * porque siempre exportamos la esfera entera: el costurero rellena de gris lo
 * que no se fotografió en vez de dejar el lienzo más chico.
 *
 * Lanza `XmpError` si las dimensiones no son enteros positivos razonables. Es
 * un error de programación, no una condición del teléfono, y quien lo llama de
 * verdad —`conGPano`— lo atrapa y sigue sin metadatos.
 */
/**
 * El rumbo de brújula que le corresponde al CENTRO de la panorámica.
 *
 * Existe como función y no como una línea dentro de quien exporta por un motivo
 * concreto: la suma se perdió una vez y ninguna de las 114 pruebas del proyecto
 * se dio cuenta, porque un rumbo equivocado se ve exactamente igual que uno
 * bueno. Aquí es una función pura de dos números y se puede barrer entera.
 *
 * @param baseYaw     Yaw CRUDO del giroscopio cuando se disparó la primera
 *                    toma. Es el cero arbitrario de `alpha` en iOS.
 * @param offsetNorte `OrientationTracker.offsetNorte`, o `null` si no hubo
 *                    brújula. En ese caso devuelve `null` y el campo no se
 *                    escribe: es mejor no decir nada que inventar un rumbo.
 */
export function rumboDelCentro(baseYaw: number, offsetNorte: number | null): number | null {
  /* La MISMA cuenta que la brújula del visor (`rumboDeEscena`, src/lib/rumbo.ts),
     para que el norte escrito en el JPEG y el norte guardado en la escena no
     puedan divergir nunca. Aquí se traduce `undefined` a `null`, que es la
     convención de este módulo. */
  return rumboDeEscena(baseYaw, offsetNorte) ?? null
}

export function paqueteGPano(opciones: OpcionesGPano): string {
  const { ancho, alto } = opciones
  if (!esEnteroSano(ancho) || !esEnteroSano(alto)) {
    throw new XmpError(`Dimensiones fuera de rango para GPano: ${ancho}×${alto}.`)
  }

  const campos: string[] = [
    // Esta es la que hace que un visor cambie de "foto normal" a "esfera".
    'GPano:UsePanoramaViewer="True"',
    'GPano:ProjectionType="equirectangular"',
    `GPano:CroppedAreaImageWidthPixels="${ancho}"`,
    `GPano:CroppedAreaImageHeightPixels="${alto}"`,
    `GPano:FullPanoWidthPixels="${ancho}"`,
    `GPano:FullPanoHeightPixels="${alto}"`,
    'GPano:CroppedAreaLeftPixels="0"',
    'GPano:CroppedAreaTopPixels="0"',
    `GPano:StitchingSoftware="${escapar(PROGRAMA)}"`,
    `GPano:CaptureSoftware="${escapar(opciones.programaDeCaptura ?? PROGRAMA)}"`,
    `GPano:InitialViewHeadingDegrees="${grados(opciones.vistaInicial ?? 0)}"`,
  ]

  const { norte, tomas, exposicionFijada } = opciones
  if (typeof norte === 'number' && Number.isFinite(norte)) {
    campos.push(`GPano:PoseHeadingDegrees="${grados(norte)}"`)
  }
  if (typeof tomas === 'number' && Number.isFinite(tomas) && tomas > 0) {
    campos.push(`GPano:SourcePhotosCount="${Math.round(tomas)}"`)
  }
  if (typeof exposicionFijada === 'boolean') {
    campos.push(`GPano:ExposureLockUsed="${exposicionFijada ? 'True' : 'False'}"`)
  }

  const atributos = campos.map((campo) => `\n    ${campo}`).join('')
  return (
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="${escapar(PROGRAMA)}">\n` +
    ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `  <rdf:Description rdf:about=""\n` +
    `    xmlns:GPano="http://ns.google.com/photos/1.0/panorama/"${atributos}/>\n` +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>`
  )
}

/* ------------------------------------------------------------- LOS BYTES */

/** ¿El segmento que empieza en `inicio` trae la firma de XMP? */
function esSegmentoXMP(bytes: Bytes, inicio: number): boolean {
  if (inicio + FIRMA_XMP.length > bytes.length) return false
  for (let i = 0; i < FIRMA_XMP.length; i++) {
    if (bytes[inicio + i] !== FIRMA_XMP.charCodeAt(i)) return false
  }
  return true
}

/**
 * En qué posición hay que meter el APP1, recorriendo los marcadores de verdad.
 *
 * Devuelve `null` cuando lo mejor es no tocar nada:
 *
 *   · no empieza con SOI, o sea que no es un JPEG;
 *   · un segmento tiene una longitud imposible (archivo truncado o corrupto);
 *   · ya hay un APP1 de XMP. Dos paquetes XMP en el mismo archivo es peor que
 *     ninguno: cada lector elige uno distinto y el que gana no es el nuestro.
 *
 * Si no hay ningún APPn —un JPEG que arranca directo en DQT, que es legal y
 * pasa— el punto de inserción es 2, justo después del SOI. Ese es precisamente
 * el caso que rompe a quien supone que siempre hay un APP0/JFIF.
 */
export function puntoDeInsercion(bytes: Bytes): number | null {
  if (bytes.length < 4) return null
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null

  let corte = 2
  let i = 2

  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return null // desincronizado: no vale la pena adivinar
    const marcador = bytes[i + 1]

    // Bytes de relleno: un marcador puede venir precedido de varios 0xFF.
    if (marcador === 0xff) {
      i++
      continue
    }

    // Cualquier cosa que no sea APP0…APP15 (DQT, SOF, DHT, SOS…) ya es el
    // cuerpo del JPEG: aquí se acaba la zona donde se pueden meter metadatos.
    if (marcador < 0xe0 || marcador > 0xef) break

    if (i + 3 >= bytes.length) return null
    const largo = (bytes[i + 2] << 8) | bytes[i + 3]
    // La longitud se cuenta a sí misma, así que menos de 2 es imposible.
    if (largo < 2 || i + 2 + largo > bytes.length) return null
    if (esSegmentoXMP(bytes, i + 4)) return null

    i += 2 + largo
    corte = i
  }

  return corte
}

/**
 * Mete el paquete XMP en el JPEG y devuelve el archivo nuevo.
 *
 * Si el JPEG no se puede recorrer con seguridad, o el paquete no cabe en un
 * APP1, devuelve los mismos bytes sin tocar. Nunca produce un archivo a medias.
 */
export function insertarXMP(jpeg: Bytes, xmp: string): Bytes {
  const corte = puntoDeInsercion(jpeg)
  if (corte === null) return jpeg

  const paquete = new TextEncoder().encode(`${XPACKET_INICIO}${xmp}${XPACKET_FIN}`)
  if (paquete.length > MAX_PAQUETE) return jpeg

  const firma = new Uint8Array(FIRMA_XMP.length)
  for (let i = 0; i < FIRMA_XMP.length; i++) firma[i] = FIRMA_XMP.charCodeAt(i)

  const largo = 2 + firma.length + paquete.length
  const segmento = new Uint8Array(2 + largo)
  segmento[0] = 0xff
  segmento[1] = 0xe1
  segmento[2] = (largo >> 8) & 0xff
  segmento[3] = largo & 0xff
  segmento.set(firma, 4)
  segmento.set(paquete, 4 + firma.length)

  const salida = new Uint8Array(jpeg.length + segmento.length) as Bytes
  salida.set(jpeg.subarray(0, corte), 0)
  salida.set(segmento, corte)
  salida.set(jpeg.subarray(corte), corte + segmento.length)
  return salida
}

/**
 * ============================================================================
 *  LA PUERTA DE ENTRADA
 * ============================================================================
 *
 * Es la única función que hay que llamar desde la interfaz: se le pasa el JPEG
 * recién generado y las dimensiones del lienzo, y devuelve el mismo JPEG con
 * los metadatos puestos.
 *
 * No lanza NUNCA. Ante cualquier problema —un navegador sin `TextEncoder`, un
 * blob que no es JPEG, un archivo que no se pudo leer— devuelve el blob
 * original, que es exactamente lo que la app exportaba antes de todo esto. El
 * peor caso posible de este archivo es volver al comportamiento de ayer.
 *
 * Los bytes se leen con `leerBytes()` y no con `blob.arrayBuffer()`: ese método
 * es de Safari 14 / iOS 14 en adelante, es un método y no sintaxis, así que el
 * compilador no lo rellena y en un iPhone viejo simplemente no existe (la misma
 * razón que ya está documentada en ../store/bytes.ts y en ./importar.ts).
 */
export async function conGPano(jpeg: Blob, opciones: OpcionesGPano): Promise<Blob> {
  try {
    const bytes = await leerBytes(jpeg)
    const salida = insertarXMP(bytes, paqueteGPano(opciones))
    // Si no se pudo insertar nada, se devuelve el blob de entrada y no una copia:
    // así quien llama no paga otra vez el megabyte y medio de la panorámica.
    if (salida === bytes) return jpeg
    return new Blob([salida], { type: jpeg.type || 'image/jpeg' })
  } catch {
    return jpeg
  }
}

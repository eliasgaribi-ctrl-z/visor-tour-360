import type { Bytes } from './zip'

/**
 * ============================================================================
 *  LEER UN BLOB COMO BYTES, TAMBIÉN EN UN SAFARI VIEJO
 * ============================================================================
 *
 * `Blob.prototype.arrayBuffer()` es de Safari 14 / iOS 14. Es un MÉTODO, no
 * sintaxis, así que el compilador no lo toca ni lo rellena: llega crudo al
 * teléfono y ahí no existe.
 *
 * Sin esto, en un iPhone con iOS 13 no se puede ni importar ni exportar un
 * `.tour`, que es justamente lo único del proyecto que no necesita WebGL y que
 * por lo tanto SÍ podría funcionar completo en ese teléfono. Y fallaba con un
 * mensaje que culpaba al archivo del usuario ("revisa que sea un .tour
 * exportado desde el visor") cuando el archivo estaba perfecto.
 *
 * `FileReader` es de siempre y hace exactamente lo mismo, solo que con
 * callbacks.
 */
export async function leerBytes(blob: Blob): Promise<Bytes> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer()) as Bytes
  }

  const buffer = await new Promise<ArrayBuffer>((listo, falla) => {
    const lector = new FileReader()
    lector.onload = () => listo(lector.result as ArrayBuffer)
    lector.onerror = () => falla(lector.error ?? new Error('No se pudo leer el archivo.'))
    lector.readAsArrayBuffer(blob)
  })
  return new Uint8Array(buffer) as Bytes
}

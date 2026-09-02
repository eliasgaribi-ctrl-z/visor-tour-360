/**
 * ============================================================================
 *  ENTREGAR UN ARCHIVO, Y EL AVISO CUANDO NO SE PUDO ARMAR
 * ============================================================================
 *
 * Las dos cosas viven aquí, aparte de `paquete.ts`, por una razón de PESO y una
 * de CORRECCIÓN. Las dos importan.
 *
 * ── Peso ──────────────────────────────────────────────────────────────────
 *
 * `paquete.ts` arrastra el escritor de ZIP, la escalera de migración y la
 * revisión de contraste: ~7.6 kB medidos en el chunk de arranque. Y no hace
 * falta ahí — armar o abrir un `.tour` siempre pasa por un gesto que ya espera
 * (elegir un archivo, tocar "Preparar archivo", que ya dice "Armando el
 * archivo…")— así que las dos pantallas que lo usan lo bajan con `import()`.
 *
 * Pero para eso necesitan DOS cosas de forma barata y síncrona: el tipo del
 * error, que se comprueba en un `catch`, y la entrega, por lo de abajo. Son
 * parte de la interfaz de la operación, no de su implementación, y una interfaz
 * tiene que poder importarse sin traer el motor entero.
 *
 * ── Corrección, que es la que no se ve venir ──────────────────────────────
 *
 * `entregarArchivo` NO PUEDE estar detrás de un `import()`. En iOS, compartir
 * solo se permite mientras dure la "activación" que dejó el toque del usuario, y
 * un `await` la gasta: la hoja de compartir no aparecería y el archivo caería en
 * Descargas sin que nadie entienda por qué. Es el mismo motivo por el que el
 * archivo se ARMA en un toque anterior y aquí solo se entrega, y está escrito
 * abajo en la función. Teniéndola en este módulo, el problema no existe.
 */

export class PaqueteError extends Error {
  consejo?: string
  constructor(message: string, consejo?: string) {
    super(message)
    this.name = 'PaqueteError'
    this.consejo = consejo
  }
}

/** El mensaje completo de un fallo al armar o abrir un `.tour`. */
export function mensajeDePaquete(error: unknown, respaldo: string): string {
  return error instanceof PaqueteError
    ? [error.message, error.consejo].filter(Boolean).join(' ')
    : respaldo
}

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = nombre
  document.body.append(enlace)
  enlace.click()
  enlace.remove()
  // Un respiro antes de revocar: si se revoca en el mismo tick, algunos
  // navegadores cancelan la descarga que acaban de empezar.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Entrega el archivo al usuario.
 *
 * IMPORTANTE: esta función no debe llevar ningún `await` antes de llamar a
 * `share()`. En iOS, compartir solo se permite mientras dure la "activación"
 * que dejó el toque del usuario, y armar un ZIP de varios megabytes se la
 * acaba. Por eso el archivo se prepara ANTES, en otro toque, y aquí solo se
 * entrega. Y por eso este módulo no está detrás de un `import()`: la promesa
 * de la carga perezosa gastaría la misma activación.
 *
 * Se intenta primero la hoja de compartir porque desde ahí el archivo se manda
 * a WhatsApp, a Archivos o por AirDrop en un toque, que es justo lo que la
 * gente quiere hacer. La descarga normal es el respaldo: funciona siempre, pero
 * el archivo aterriza en la carpeta de Descargas y hay que ir a buscarlo.
 */
export function entregarArchivo(blob: Blob, nombre: string): 'compartido' | 'descargado' {
  const file = new File([blob], nombre, { type: 'application/zip' })

  if (navigator.canShare?.({ files: [file] })) {
    void navigator.share({ files: [file], title: nombre }).catch((error: unknown) => {
      // Cancelar la hoja de compartir NO es un fallo: descargar el archivo
      // "por si acaso" le deja al usuario en Descargas algo que decidió no
      // mandar.
      if ((error as Error)?.name === 'AbortError') return
      descargar(blob, nombre)
    })
    return 'compartido'
  }

  descargar(blob, nombre)
  return 'descargado'
}

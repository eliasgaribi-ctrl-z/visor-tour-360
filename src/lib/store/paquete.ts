import type { Hotspot } from '../types'
import type { StoredScene, StoredTour } from './types'
import { FORMAT_VERSION } from './types'
import { createZip, readZip, type ZipEntry } from './zip'
import { leerBytes } from './bytes'
import { STORE_BLOBS, STORE_TOURS, idbPut, tx } from './idb'
import { getImage, getTour } from './tours'
import { newId } from './ids'

/**
 * ============================================================================
 *  EL ARCHIVO .tour
 * ============================================================================
 *
 * Un recorrido guardado vive dentro del navegador, y el navegador lo puede
 * borrar: Safari en iOS limpia el almacenamiento de los sitios que pasan siete
 * días sin abrirse, y cualquier teléfono lo hace si se queda sin espacio.
 *
 * El `.tour` es el respaldo que no depende de eso, y de paso es cómo se pasa un
 * recorrido de un teléfono a otro. Por dentro es un ZIP normal:
 *
 *   recorrido.json           qué habitaciones hay, cómo se llaman, sus puntos
 *   fotos/<escena>.jpg       la panorámica de cada habitación
 *   fotos/<escena>.min.jpg   su miniatura
 *
 * Se puede abrir con cualquier descompresor, así que las fotos nunca quedan
 * secuestradas dentro de un formato propio.
 */

const CARPETA = 'fotos'
const MANIFIESTO = 'recorrido.json'
const MARCA = 'visor-tour-360'

type EscenaManifiesto = {
  id: string
  name: string
  archivo: string
  miniatura?: string
  initialYaw?: number
  hotspots: Hotspot[]
  origin?: StoredScene['origin']
  coverageDeg?: number
  createdAt: number
}

type Manifiesto = {
  formato: string
  version: number
  exportadoEn: string
  recorrido: {
    id: string
    title: string
    subtitle?: string
    startSceneId: string
    createdAt: number
    scenes: EscenaManifiesto[]
  }
}

export class PaqueteError extends Error {
  consejo?: string
  constructor(message: string, consejo?: string) {
    super(message)
    this.name = 'PaqueteError'
    this.consejo = consejo
  }
}

// leerBytes y no blob.arrayBuffer(): ese método es de iOS 14 en adelante, y
// exportar el .tour es de lo poco que sí puede funcionar en un iPhone viejo.
const bytes = leerBytes

/** Nombre de archivo sugerido: "casa-en-tlajomulco.tour". */
export function nombreDeArchivo(tour: { title: string }): string {
  const base = tour.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${base || 'recorrido'}.tour`
}

/**
 * Arma el archivo.
 *
 * Los Blobs se leen FUERA de cualquier transacción de IndexedDB: una
 * transacción se cierra sola en cuanto la cola de microtareas se vacía sin
 * peticiones pendientes, así que un `await blob.arrayBuffer()` adentro la mata
 * y la siguiente operación truena. Es un error que solo aparece en los
 * teléfonos lentos, que es la peor forma de que aparezca.
 */
export async function exportarTour(
  tourId: string,
  avance?: (hechas: number, total: number) => void,
): Promise<{ blob: Blob; nombre: string }> {
  const tour = await getTour(tourId)
  if (!tour) throw new PaqueteError('Ese recorrido ya no está guardado en este teléfono.')

  const entradas: ZipEntry[] = []
  const escenas: EscenaManifiesto[] = []

  for (const [indice, scene] of tour.scenes.entries()) {
    const foto = await getImage(scene.imageId)
    if (!foto) {
      throw new PaqueteError(
        `A la habitación "${scene.name}" le falta su foto.`,
        'Vuelve a tomarla o bórrala del recorrido y exporta de nuevo.',
      )
    }

    const archivo = `${CARPETA}/${scene.id}.jpg`
    entradas.push({ name: archivo, data: await bytes(foto) })

    let miniatura: string | undefined
    if (scene.thumbId) {
      const mini = await getImage(scene.thumbId)
      if (mini) {
        miniatura = `${CARPETA}/${scene.id}.min.jpg`
        entradas.push({ name: miniatura, data: await bytes(mini) })
      }
    }

    escenas.push({
      id: scene.id,
      name: scene.name,
      archivo,
      miniatura,
      initialYaw: scene.initialYaw,
      hotspots: scene.hotspots,
      origin: scene.origin,
      coverageDeg: scene.coverageDeg,
      createdAt: scene.createdAt,
    })

    avance?.(indice + 1, tour.scenes.length)
  }

  const manifiesto: Manifiesto = {
    formato: MARCA,
    version: FORMAT_VERSION,
    exportadoEn: new Date().toISOString(),
    recorrido: {
      id: tour.id,
      title: tour.title,
      subtitle: tour.subtitle,
      startSceneId: tour.startSceneId,
      createdAt: tour.createdAt,
      scenes: escenas,
    },
  }

  entradas.unshift({
    name: MANIFIESTO,
    data: new TextEncoder().encode(JSON.stringify(manifiesto, null, 2)),
  })

  return { blob: createZip(entradas), nombre: nombreDeArchivo(tour) }
}

/**
 * Lee un archivo .tour y lo guarda como un recorrido NUEVO.
 *
 * Siempre con id nuevo, nunca encima de uno que ya existía. El caso real es
 * "me pasaron el recorrido por WhatsApp y yo ya tenía mi versión": sobrescribir
 * borraría trabajo sin manera de deshacerlo.
 */
export async function importarTour(archivo: Blob): Promise<StoredTour> {
  let contenido
  try {
    contenido = await readZip(archivo)
  } catch (error) {
    throw new PaqueteError(
      error instanceof Error ? error.message : 'No se pudo leer el archivo.',
      'Revisa que sea un archivo .tour exportado desde el visor.',
    )
  }

  const manifiestoCrudo = contenido.find((f) => f.name === MANIFIESTO)
  if (!manifiestoCrudo) {
    throw new PaqueteError('Ese archivo no es un recorrido del visor (le falta el manifiesto).')
  }

  let manifiesto: Manifiesto
  try {
    manifiesto = JSON.parse(new TextDecoder().decode(manifiestoCrudo.data))
  } catch {
    throw new PaqueteError('El recorrido viene dañado: no se entendió su manifiesto.')
  }

  if (manifiesto.formato !== MARCA) {
    throw new PaqueteError('Ese archivo fue hecho por otro programa y no se puede abrir aquí.')
  }
  if (manifiesto.version > FORMAT_VERSION) {
    throw new PaqueteError(
      'Ese recorrido se hizo con una versión más nueva del visor.',
      'Actualiza la página y vuelve a intentar.',
    )
  }
  if (!Array.isArray(manifiesto.recorrido?.scenes)) {
    throw new PaqueteError('El recorrido viene dañado: no trae habitaciones.')
  }

  const porNombre = new Map(contenido.map((f) => [f.name, f.data]))
  const tourId = newId('tour')
  const escenas: StoredScene[] = []
  const blobs: { id: string; blob: Blob }[] = []
  /* El archivo viene de fuera y pudo editarse a mano. Dos habitaciones con el
     mismo id romperían las listas de React y harían que un punto llevara a la
     habitación equivocada, así que la segunda se renombra. */
  const idsVistos = new Set<string>()
  const renombradas = new Map<string, string>()

  for (const escena of manifiesto.recorrido.scenes) {
    const foto = porNombre.get(escena.archivo)
    if (!foto) continue // habitación sin foto: se omite en vez de tumbar todo

    const imageId = newId('img')
    blobs.push({ id: imageId, blob: new Blob([foto], { type: 'image/jpeg' }) })

    let thumbId: string | undefined
    const mini = escena.miniatura ? porNombre.get(escena.miniatura) : undefined
    if (mini) {
      thumbId = newId('img')
      blobs.push({ id: thumbId, blob: new Blob([mini], { type: 'image/jpeg' }) })
    }

    const idOriginal = typeof escena.id === 'string' ? escena.id : ''
    const id = idOriginal && !idsVistos.has(idOriginal) ? idOriginal : newId('esc')
    if (id !== idOriginal && idOriginal) renombradas.set(idOriginal, id)
    idsVistos.add(id)

    escenas.push({
      id,
      name: escena.name || 'Habitación',
      imageId,
      thumbId,
      initialYaw: escena.initialYaw ?? 0,
      hotspots: Array.isArray(escena.hotspots) ? escena.hotspots : [],
      origin: escena.origin,
      coverageDeg: escena.coverageDeg,
      createdAt: escena.createdAt ?? Date.now(),
    })
  }

  if (escenas.length === 0) {
    throw new PaqueteError('El archivo no traía ninguna foto utilizable.')
  }

  // Si hubo que renombrar, los puntos que llevaban a esas habitaciones también.
  if (renombradas.size > 0) {
    for (const escena of escenas) {
      escena.hotspots = escena.hotspots.map((h) =>
        h.kind === 'link' && renombradas.has(h.to) ? { ...h, to: renombradas.get(h.to)! } : h,
      )
    }
  }

  const ahora = Date.now()
  const tour: StoredTour = {
    id: tourId,
    title: manifiesto.recorrido.title || 'Recorrido importado',
    subtitle: manifiesto.recorrido.subtitle,
    startSceneId: escenas.some((s) => s.id === manifiesto.recorrido.startSceneId)
      ? manifiesto.recorrido.startSceneId
      : escenas[0].id,
    scenes: escenas,
    createdAt: manifiesto.recorrido.createdAt ?? ahora,
    updatedAt: ahora,
  }

  // Todo de una vez: si truena a media escritura no queda un recorrido
  // apuntando a fotos que no existen.
  await tx([STORE_TOURS, STORE_BLOBS], 'readwrite', async (t) => {
    for (const registro of blobs) await idbPut(t, STORE_BLOBS, registro)
    await idbPut(t, STORE_TOURS, tour)
  })

  return tour
}

/**
 * Entrega el archivo al usuario.
 *
 * IMPORTANTE: esta función no debe llevar ningún `await` antes de llamar a
 * `share()`. En iOS, compartir solo se permite mientras dure la "activación"
 * que dejó el toque del usuario, y armar un ZIP de varios megabytes se la
 * acaba. Por eso el archivo se prepara ANTES, en otro toque, y aquí solo se
 * entrega.
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

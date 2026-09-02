import type { Tour, TourScene } from '../types'
import type { StoredScene, StoredTour, TourSummary } from './types'
import { FORMAT_VERSION } from './types'
import { normalizarTour } from './normalizar'
import {
  STORE_BLOBS,
  STORE_TOURS,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  tx,
} from './idb'
import { newId } from './ids'
import { olvidarTextura } from '../texturasVivas'

type BlobRecord = { id: string; blob: Blob }

/* ---------------------------------------------------------------------------
   URLS DE OBJETO
   ---------------------------------------------------------------------------
   Una URL `blob:` es un puntero que el navegador mantiene vivo hasta que se
   revoca. Se cachean POR LLAVE DE BLOB y se reutilizan durante toda la sesión
   porque el caché de texturas (src/lib/useEquirectTexture.ts) es global y está
   indexado por URL: si cada apertura del recorrido creara URLs nuevas, la misma
   foto se subiría a la GPU una y otra vez.
--------------------------------------------------------------------------- */
const urls = new Map<string, string>()

export async function blobUrl(imageId: string): Promise<string | null> {
  const cached = urls.get(imageId)
  if (cached) return cached

  const blob = await getImage(imageId)
  if (!blob) return null

  const url = URL.createObjectURL(blob)
  urls.set(imageId, url)
  return url
}

/**
 * Suelta la URL de un blob que ya no se va a usar (foto reemplazada o borrada).
 *
 * Hay que sacarla TAMBIÉN del caché de texturas: ese caché vive aparte, está
 * indexado por URL y no se entera de que el blob murió.
 */
export function releaseBlobUrl(imageId: string) {
  const url = urls.get(imageId)
  if (!url) return
  olvidarTextura(url)
  URL.revokeObjectURL(url)
  urls.delete(imageId)
  return url
}

/* --------------------------------------------------------------- IMÁGENES */

export async function putImage(blob: Blob, id = newId('img')): Promise<string> {
  await tx(STORE_BLOBS, 'readwrite', (t) => idbPut(t, STORE_BLOBS, { id, blob }))
  return id
}

export async function getImage(id: string): Promise<Blob | null> {
  const record = await tx(STORE_BLOBS, 'readonly', (t) =>
    idbGet<BlobRecord>(t, STORE_BLOBS, id),
  )
  return record?.blob ?? null
}

export async function deleteImage(id: string) {
  releaseBlobUrl(id)
  await tx(STORE_BLOBS, 'readwrite', (t) => idbDelete(t, STORE_BLOBS, id))
}

/* -------------------------------------------------------------- RECORRIDOS */

export async function listTours(): Promise<TourSummary[]> {
  const tours = await tx(STORE_TOURS, 'readonly', (t) => idbGetAll<StoredTour>(t, STORE_TOURS))
  return tours
    .map((tour) => ({
      id: tour.id,
      title: tour.title,
      subtitle: tour.subtitle,
      scenes: tour.scenes.length,
      updatedAt: tour.updatedAt,
      coverId: tour.scenes[0]?.thumbId ?? tour.scenes[0]?.imageId,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Un recorrido guardado, con la forma que los componentes esperan.
 *
 * Pasa por `normalizarTour` a propósito, y es el ÚNICO lugar donde hace falta:
 * los registros de IndexedDB los escribió una versión anterior de esta misma app
 * y nadie los re-valida nunca. Sin esto, un `StoredTour` viejo llega con los
 * campos nuevos ausentes directo a un render, y el fallo aparece lejos de la
 * causa. `normalizarTour` devuelve el mismo objeto cuando ya está bien, que es
 * el caso normal, así que no cuesta nada.
 */
export async function getTour(id: string): Promise<StoredTour | null> {
  const tour = await tx(STORE_TOURS, 'readonly', (t) => idbGet<StoredTour>(t, STORE_TOURS, id))
  return tour ? normalizarTour(tour) : null
}

/**
 * Lo último que le pasa a un recorrido antes de escribirse: la estampa de
 * versión y la fecha.
 *
 * Existe porque no hay UN camino de escritura, hay tres: `saveTour`,
 * `guardarEscenaConFoto` y `reemplazarFoto`, y las dos últimas usan `idbPut`
 * directo porque escriben el recorrido y sus blobs en la MISMA transacción.
 * Los tres ponían `updatedAt: Date.now()` por su cuenta, y al agregarle la
 * estampa de versión al modelo se me olvidaron dos de los tres — o sea que
 * cualquier recorrido hecho con la cámara se habría quedado sin ella, en
 * silencio, y el problema no aparecería hasta la migración a la v3.
 *
 * Así que la sella una sola función, y `tools/pruebas/patrones.mjs` se pone rojo
 * si aparece un escritor nuevo del almacén de recorridos. Ver el comentario de
 * `formato` en ./types.ts.
 */
function paraGuardar(tour: StoredTour): StoredTour {
  return { ...tour, formato: FORMAT_VERSION, updatedAt: Date.now() }
}

export async function saveTour(tour: StoredTour): Promise<StoredTour> {
  const next = paraGuardar(tour)
  await tx(STORE_TOURS, 'readwrite', (t) => idbPut(t, STORE_TOURS, next))
  return next
}

export async function deleteTour(id: string): Promise<void> {
  const tour = await getTour(id)
  if (!tour) return

  /* El logo entra en la lista igual que las fotos: desde que viaja dentro del
     `.tour` hay un blob de logo por cada recorrido importado, y sin esto cada
     borrado dejaba uno huérfano ocupando espacio que nadie iba a reclamar. */
  const imageIds = [
    ...tour.scenes.flatMap((s) => [s.imageId, s.thumbId]),
    tour.marca?.logoId,
  ].filter(Boolean) as string[]
  for (const imageId of imageIds) releaseBlobUrl(imageId)

  await tx([STORE_TOURS, STORE_BLOBS], 'readwrite', async (t) => {
    for (const imageId of imageIds) await idbDelete(t, STORE_BLOBS, imageId)
    await idbDelete(t, STORE_TOURS, id)
  })
}

export function createTour(title: string): StoredTour {
  const now = Date.now()
  return {
    id: newId('tour'),
    title: title.trim() || 'Recorrido sin nombre',
    startSceneId: '',
    scenes: [],
    createdAt: now,
    updatedAt: now,
  }
}

/* --------------------------------------------------- GUARDADO → RUNTIME */

/**
 * Convierte un recorrido guardado en el `Tour` que consume el visor: cada
 * `imageId` se cambia por una URL `blob:` viva.
 *
 * Las habitaciones cuya foto ya no está en la base (borrada a mano, importación
 * incompleta) se omiten en vez de romper el visor con una pantalla negra.
 */
export async function resolveTour(stored: StoredTour): Promise<Tour> {
  const scenes: TourScene[] = []

  for (const scene of stored.scenes) {
    const image = await blobUrl(scene.imageId)
    if (!image) continue
    const thumbnail = scene.thumbId ? ((await blobUrl(scene.thumbId)) ?? undefined) : undefined
    scenes.push({
      id: scene.id,
      name: scene.name,
      image,
      thumbnail,
      initialYaw: scene.initialYaw ?? 0,
      // Un hotspot que apunta a una habitación que ya no existe se cae aquí:
      // dejarlo mostraría un botón que no lleva a ningún lado.
      hotspots: scene.hotspots.filter(
        (h) => h.kind !== 'link' || stored.scenes.some((s) => s.id === h.to),
      ),
    })
  }

  const startSceneId = scenes.some((s) => s.id === stored.startSceneId)
    ? stored.startSceneId
    : (scenes[0]?.id ?? '')

  /* La marca viaja casi igual; lo único que cambia es el logo, que en la base es
     una llave de Blob y el visor necesita como URL. Mismo puente que las fotos. */
  let marca: Tour['marca']
  if (stored.marca) {
    /* Se copian los campos a mano en vez de usar `const { logoId, ...resto }`.
       El object rest es de ES2018 y el bundle se compila para Safari 13, así que
       TypeScript emite un helper para bajarlo de nivel — y ese helper resultó ser
       un chunk propio de 10 kB que se PRECARGABA en el arranque, subiendo el
       peso de "Mis recorridos" de 236 a 243 kB. Por una línea más corta.
       Medido con el mismo paso del CI que vigila ese presupuesto. */
    const m = stored.marca
    const logo = m.logoId ? ((await blobUrl(m.logoId)) ?? undefined) : undefined
    marca = {
      nombre: m.nombre,
      colores: m.colores,
      hudFondo: m.hudFondo,
      fondoApp: m.fondoApp,
      tipografia: m.tipografia,
      logo,
    }
  }

  return {
    title: stored.title,
    subtitle: stored.subtitle,
    startSceneId,
    scenes,
    marca,
    ficha: stored.ficha,
  }
}

/** Habitación nueva, ya con la foto guardada. */
/**
 * Guarda una habitación nueva con su foto y su miniatura EN UNA SOLA
 * transacción.
 *
 * Si se hiciera en pasos sueltos y el teléfono se quedara sin espacio a media
 * operación, quedaría un recorrido apuntando a una foto que no existe: el visor
 * abriría en negro sin explicación. Una transacción de IndexedDB es atómica —
 * o entran las tres cosas o no entra ninguna.
 */
export async function guardarEscenaConFoto(params: {
  tour: StoredTour
  scene: StoredScene
  foto: Blob
  miniatura?: Blob
}): Promise<StoredTour> {
  const { tour, scene, foto, miniatura } = params
  const siguiente = paraGuardar({
    ...tour,
    scenes: [...tour.scenes.filter((s) => s.id !== scene.id), scene],
    startSceneId: tour.startSceneId || scene.id,
  })

  await tx([STORE_TOURS, STORE_BLOBS], 'readwrite', async (t) => {
    await idbPut(t, STORE_BLOBS, { id: scene.imageId, blob: foto })
    if (miniatura && scene.thumbId) {
      await idbPut(t, STORE_BLOBS, { id: scene.thumbId, blob: miniatura })
    }
    await idbPut(t, STORE_TOURS, siguiente)
  })

  return siguiente
}

/**
 * Cambia la foto de una habitación sin tocar su nombre ni sus puntos.
 *
 * Se escribe la foto NUEVA junto con el recorrido en una sola transacción y la
 * vieja se borra DESPUÉS. En ese orden: si se borrara primero y la escritura
 * fallara por falta de espacio, la habitación se quedaría sin ninguna foto.
 * Al revés, lo peor que puede pasar es que sobre una imagen huérfana.
 */
export async function reemplazarFoto(params: {
  tour: StoredTour
  sceneId: string
  foto: Blob
  miniatura?: Blob
  origin?: StoredScene['origin']
  coverageDeg?: number
}): Promise<StoredTour> {
  const { tour, sceneId, foto, miniatura, origin, coverageDeg } = params
  const anterior = tour.scenes.find((s) => s.id === sceneId)
  if (!anterior) throw new Error('Esa habitación ya no está en el recorrido.')

  const imageId = newId('img')
  const thumbId = miniatura ? newId('img') : undefined

  const siguiente = paraGuardar({
    ...tour,
    scenes: tour.scenes.map((s) =>
      s.id === sceneId
        ? {
            ...s,
            imageId,
            thumbId,
            origin: origin ?? s.origin,
            coverageDeg: coverageDeg ?? s.coverageDeg,
          }
        : s,
    ),
  })

  await tx([STORE_TOURS, STORE_BLOBS], 'readwrite', async (t) => {
    await idbPut(t, STORE_BLOBS, { id: imageId, blob: foto })
    if (miniatura && thumbId) await idbPut(t, STORE_BLOBS, { id: thumbId, blob: miniatura })
    await idbPut(t, STORE_TOURS, siguiente)
  })

  await deleteImage(anterior.imageId)
  if (anterior.thumbId) await deleteImage(anterior.thumbId)

  return siguiente
}

/**
 * ¿Se puede escribir en este navegador?
 *
 * En navegación privada IndexedDB existe pero puede fallar al escribir o
 * vaciarse al cerrar la pestaña. Vale más descubrirlo antes de que el usuario
 * tome quince fotos que después de.
 */
export async function almacenamientoUtilizable(): Promise<boolean> {
  const prueba = '__prueba__'
  try {
    await tx(STORE_BLOBS, 'readwrite', (t) =>
      idbPut(t, STORE_BLOBS, { id: prueba, blob: new Blob(['ok']) }),
    )
    const leido = await getImage(prueba)
    await tx(STORE_BLOBS, 'readwrite', (t) => idbDelete(t, STORE_BLOBS, prueba))
    return leido !== null && leido.size > 0
  } catch {
    return false
  }
}

export function createScene(params: {
  id: string
  name: string
  imageId: string
  thumbId?: string
  origin?: StoredScene['origin']
  coverageDeg?: number
}): StoredScene {
  return {
    id: params.id,
    name: params.name,
    imageId: params.imageId,
    thumbId: params.thumbId,
    origin: params.origin,
    coverageDeg: params.coverageDeg,
    initialYaw: 0,
    hotspots: [],
    createdAt: Date.now(),
  }
}

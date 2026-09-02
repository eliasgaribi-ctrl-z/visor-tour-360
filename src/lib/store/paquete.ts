import type { Hotspot } from '../types'
import type { StoredScene, StoredTour } from './types'
import { FORMAT_VERSION } from './types'
import type { Ficha } from '../types'
import type { MarcaGuardada } from './types'
import { limpiarEscena, limpiarFicha, limpiarMarca, migrarRecorrido } from './migrar'
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
 *   marca/logo.png           el logo de la inmobiliaria, si el recorrido trae
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

/**
 * La marca dentro del manifiesto.
 *
 * Igual que `MarcaGuardada` pero con `logoArchivo` —una entrada del ZIP— en vez
 * de `logoId`, que es una llave del IndexedDB del teléfono que exportó y no
 * significa nada en otro aparato. Mismo patrón que `archivo`/`miniatura` de las
 * escenas, y por la misma razón.
 */
type MarcaManifiesto = Omit<MarcaGuardada, 'logoId'> & { logoArchivo?: string }

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
    /* Desde la v2. Los dos opcionales, así que un archivo v1 se lee igual. */
    marca?: MarcaManifiesto
    ficha?: Ficha
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
): Promise<{ blob: Blob; nombre: string; faltantes: string[] }> {
  const tour = await getTour(tourId)
  if (!tour) throw new PaqueteError('Ese recorrido ya no está guardado en este teléfono.')

  const entradas: ZipEntry[] = []
  const escenas: EscenaManifiesto[] = []
  /** Habitaciones que se quedaron fuera porque su foto ya no estaba. */
  const faltantes: string[] = []

  for (const [indice, scene] of tour.scenes.entries()) {
    const foto = await getImage(scene.imageId)
    /* ── Una foto perdida ya no cancela el respaldo entero ──────────────────
     *
     * Antes esto lanzaba y el `.tour` no se armaba. El problema es CUÁNDO pasa:
     * el archivo existe precisamente porque Safari en iOS borra el
     * almacenamiento de los sitios que pasan siete días sin abrirse, y ese
     * borrado no es limpio ni ordenado. En ese escenario —el único en el que el
     * respaldo de verdad importa— negarse en bloque por una habitación se lleva
     * también las nueve que sí estaban.
     *
     * Y era incoherente además: los DOS lectores (`importarTour` y el visor)
     * omiten la habitación sin foto y siguen. El escritor era el estricto.
     *
     * Se exporta lo que hay y se dice qué se quedó fuera; el error duro se
     * guarda para cuando no queda ninguna, que es el mismo criterio que ya usa
     * la importación. */
    if (!foto) {
      faltantes.push(scene.name)
      avance?.(indice + 1, tour.scenes.length)
      continue
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

  if (escenas.length === 0) {
    throw new PaqueteError(
      'Ninguna habitación de este recorrido tiene su foto en el teléfono.',
      'Vuelve a tomarlas, o abre el último archivo que hayas exportado.',
    )
  }

  /* El logo viaja como ARCHIVO. Con solo la `marca` en bloque llegaban al otro
     teléfono los colores y el nombre, y el logo desaparecía sin un solo error:
     `logoId` es una llave local y del otro lado no apunta a nada. */
  const marca = await marcaParaArchivo(tour.marca, entradas)

  const manifiesto: Manifiesto = {
    formato: MARCA,
    version: FORMAT_VERSION,
    exportadoEn: new Date().toISOString(),
    recorrido: {
      id: tour.id,
      title: tour.title,
      subtitle: tour.subtitle,
      startSceneId: escenas.some((e) => e.id === tour.startSceneId)
        ? tour.startSceneId
        : escenas[0].id,
      createdAt: tour.createdAt,
      scenes: escenas,
      marca,
      ficha: tour.ficha,
    },
  }

  entradas.unshift({
    name: MANIFIESTO,
    data: new TextEncoder().encode(JSON.stringify(manifiesto, null, 2)),
  })

  return { blob: createZip(entradas), nombre: nombreDeArchivo(tour), faltantes }
}

/** Extensiones de logo que se aceptan, y con qué tipo se vuelve a guardar. */
const LOGOS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
}
const TIPO_DE_LOGO: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/**
 * Pasa la marca de la forma que se guarda a la forma que viaja: mete el logo
 * como entrada del ZIP y cambia `logoId` por `logoArchivo`.
 *
 * Los campos se copian a MANO y no con `const { logoId, ...resto }`. El object
 * rest es de ES2018 y el bundle se compila para Safari 13, así que TypeScript
 * emite un helper para bajarlo de nivel — y ese helper resultó ser un chunk
 * propio de 10 kB que se PRECARGABA en el arranque. Está medido y documentado
 * igual en `resolveTour`.
 *
 * Un formato que no esté en la lista se omite en silencio: mejor un recorrido sin
 * logo que un `.tour` con un SVG dentro, que es un vector de XSS y sanearlo bien
 * es su propio trabajo.
 */
async function marcaParaArchivo(
  guardada: MarcaGuardada | undefined,
  entradas: ZipEntry[],
): Promise<MarcaManifiesto | undefined> {
  if (!guardada) return undefined

  const marca: MarcaManifiesto = {
    nombre: guardada.nombre,
    colores: guardada.colores,
    hudFondo: guardada.hudFondo,
    fondoApp: guardada.fondoApp,
    tipografia: guardada.tipografia,
  }

  if (guardada.logoId) {
    const logo = await getImage(guardada.logoId)
    const extension = logo ? LOGOS[logo.type] : undefined
    if (logo && extension) {
      const nombre = `marca/logo${extension}`
      entradas.push({ name: nombre, data: await bytes(logo) })
      marca.logoArchivo = nombre
    }
  }

  return marca
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

  /* Un solo paso por la escalera de versiones, aquí y no repartido: de aquí en
     adelante el resto de esta función solo ve la forma de la versión actual. */
  manifiesto.recorrido = migrarRecorrido(
    manifiesto.recorrido as unknown as Record<string, unknown>,
    typeof manifiesto.version === 'number' ? manifiesto.version : 1,
  ) as unknown as Manifiesto['recorrido']

  const porNombre = new Map(contenido.map((f) => [f.name, f.data]))
  const tourId = newId('tour')
  const escenas: StoredScene[] = []
  const blobs: { id: string; blob: Blob }[] = []
  /* El archivo viene de fuera y pudo editarse a mano. Dos habitaciones con el
     mismo id romperían las listas de React, así que la segunda se renombra. */
  const idsVistos = new Set<string>()

  for (const crudo of manifiesto.recorrido.scenes) {
    /* Campo por campo, igual que la marca y la ficha. Antes los numéricos
       entraban tal cual y un `"initialYaw": "90"` se guardaba como string: en el
       rig, `'90' + 0` es `'900'`. Ver `limpiarEscena` en migrar.ts. */
    const escena = limpiarEscena(crudo)
    if (!escena) continue

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

    /* ── Al id repetido se le da uno nuevo, y los enlaces NO se reescriben ───
     *
     * Reescribirlos era peor que el problema que arreglaban. El bucle mandaba
     * TODOS los puntos que apuntaban al id repetido a la habitación renombrada,
     * incluidos los que apuntaban a la que SÍ conservó ese id — o sea que la
     * puerta que decía "A la sala" abría la bodega colada al final del archivo,
     * exactamente el fallo que el comentario decía prevenir. Y se contradecía
     * con `startSceneId`, que resuelve el duplicado a la PRIMERA.
     *
     * Sin reescritura, los enlaces siguen llevando a la habitación que se quedó
     * con el id y la renombrada queda inalcanzable. Eso es la única lectura
     * honesta de un archivo ambiguo: la habitación se conserva y se puede volver
     * a enlazar desde el editor, pero nadie inventa a dónde llevaba una puerta. */
    const id = escena.id && !idsVistos.has(escena.id) ? escena.id : newId('esc')
    idsVistos.add(id)

    escenas.push({
      id,
      name: escena.name,
      imageId,
      thumbId,
      initialYaw: escena.initialYaw,
      hotspots: escena.hotspots,
      origin: escena.origin,
      coverageDeg: escena.coverageDeg,
      createdAt: escena.createdAt,
    })
  }

  if (escenas.length === 0) {
    throw new PaqueteError('El archivo no traía ninguna foto utilizable.')
  }

  /* El archivo viene de fuera y pudo editarse a mano, así que la marca y la
     ficha se filtran campo por campo. No es paranoia de más: los colores de la
     marca acaban dentro de un `style.setProperty()`, y un string arbitrario ahí
     es una inyección de CSS. Ver `limpiarMarca` en migrar.ts. */
  const marca = limpiarMarca(manifiesto.recorrido.marca)
  const ficha = limpiarFicha(manifiesto.recorrido.ficha)

  /* El logo llega como archivo del ZIP y se vuelve a guardar como blob local.
     `limpiarMarca` deja fuera cualquier `logoId` del manifiesto a propósito: esa
     llave es del otro teléfono. La única forma de tener logo es traerlo.

     El tipo del Blob se decide por la EXTENSIÓN de la lista blanca y nunca por
     lo que diga el archivo: un `marca/logo.png` con un SVG dentro se guardará
     como `image/png`, así que su `blob:` URL no puede acabar siendo
     `image/svg+xml` — que es donde un logo subido por un tercero dejaría de ser
     una imagen y pasaría a ser un documento con scripts. */
  const logoArchivo = manifiesto.recorrido.marca?.logoArchivo
  if (marca && typeof logoArchivo === 'string') {
    const datos = porNombre.get(logoArchivo)
    const punto = logoArchivo.lastIndexOf('.')
    const tipo = punto < 0 ? undefined : TIPO_DE_LOGO[logoArchivo.slice(punto).toLowerCase()]
    if (datos && tipo) {
      const logoId = newId('img')
      blobs.push({ id: logoId, blob: new Blob([datos], { type: tipo }) })
      marca.logoId = logoId
    }
  }

  const ahora = Date.now()
  const tour: StoredTour = {
    id: tourId,
    /* El importador escribe con `idbPut` directo y no con `saveTour`, así que la
       estampa se pone a mano: sin esto, cada recorrido que entra por un archivo
       quedaría sin versión. Ver el comentario de `formato` en ./types.ts. */
    formato: FORMAT_VERSION,
    marca,
    ficha,
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

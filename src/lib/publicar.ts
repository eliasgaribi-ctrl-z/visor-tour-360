/**
 * ============================================================================
 *  PUBLICAR UNA CASA PARA PODER ENSEÑARLA POR LINK
 * ============================================================================
 *
 * Hasta aquí, un recorrido armado en el celular vivía en IndexedDB, que es
 * memoria de ESE teléfono. `#/ver/<id>` parece compartible pero el id se busca
 * en el almacén de quien abre: al cliente le sale "no se encontró". La única
 * salida era mandar el `.tour` y pedirle que lo importara, que nadie hace.
 *
 * Este módulo sube la casa a un Worker de Cloudflare (ver ../../worker/) y
 * devuelve un link normal, de los que se pegan en WhatsApp.
 *
 * ── Lo que NO cambia ────────────────────────────────────────────────────────
 *
 * Publicar es opcional y va por encima de todo lo demás. Si no se configura
 * nada, el visor funciona exactamente igual que antes: los recorridos siguen
 * viviendo en el teléfono, el `.tour` se sigue exportando, y el botón de
 * publicar ni siquiera aparece. Nada de lo que ya funcionaba depende de esto.
 *
 * ── El código ───────────────────────────────────────────────────────────────
 *
 * Subir pide un código —el de invitación de la inmobiliaria, o la clave maestra
 * del servidor— y ese código NO está en el paquete de la app. No es descuido:
 * este visor es un sitio estático y su JavaScript lo puede leer cualquiera, así
 * que una clave incrustada aquí sería pública el día uno. La escribe la persona
 * una vez en su teléfono y se queda en `localStorage`.
 *
 * Cada casa publicada recibe además un CÓDIGO DE RESCATE (`editToken`), que el
 * Worker entrega una sola vez y que vive solo en el teléfono que publicó: es lo
 * que autoriza a volver a subir y a dar de baja esa llave en concreto. Si se
 * pierde el teléfono, el código de la inmobiliaria alcanza para dar de baja, y
 * el de rescate —que el editor enseña para que se guarde aparte— para
 * republicar desde otro. El porqué completo está en el encabezado del Worker.
 *
 * ── El manifiesto es la versión 2 ───────────────────────────────────────────
 *
 * La v1 llevaba las habitaciones y sus puntos, y el link abría directo en la
 * foto. La v2 lleva lo que hace que el link sea el PRODUCTO: la ficha (precio,
 * metros, contacto), que el visor enseña como portada y el Worker usa para la
 * tarjeta de WhatsApp; la marca con su logo; el modo kiosco; y por habitación
 * el rumbo, el nivel y la cobertura. Y una variante de 2048 px de cada foto,
 * porque un teléfono modesto se bajaba 1.5 MB por cuarto para encogerlos.
 *
 * Los dos lados filtran. El Worker acota formas y tamaños; aquí, al bajar, se
 * pasa lo que llega por `limpiarMarca`, `limpiarFicha` y `limpiarEscena` —las
 * mismas funciones con las que se filtra un `.tour` ajeno— porque un manifiesto
 * publicado también es de una red que no se controla.
 */

import type { Ficha, Tour, TourScene } from './types'
import type { MarcaGuardada, StoredTour } from './store/types'
import type { Resumen } from './metricas/resumen'
import { getImage } from './store/tours'
import { limpiarEscena, limpiarFicha, limpiarMarca } from './store/migrar'

/**
 * Dirección del Worker, sin barra final. Se fija al compilar:
 *
 *     VITE_PUBLICAR_BASE=https://visor-tours.tu-cuenta.workers.dev npm run build
 *
 * Vacía —que es lo que pasa si nadie la puso— desactiva la función entera.
 */
const BASE = (import.meta.env.VITE_PUBLICAR_BASE ?? '').replace(/\/+$/, '')

/** ¿Está configurada la publicación en este build? */
export function sePuedePublicar(): boolean {
  return BASE.length > 0
}

/** La dirección del Worker, para quien tenga que hablarle aparte (las métricas). */
export function basePublicar(): string {
  return BASE
}

const CLAVE_GUARDADA = 'visor-tour-360:clave-publicacion'

export function claveGuardada(): string {
  try {
    return localStorage.getItem(CLAVE_GUARDADA) ?? ''
  } catch {
    return ''
  }
}

export function guardarClave(clave: string) {
  try {
    if (clave) localStorage.setItem(CLAVE_GUARDADA, clave)
    else localStorage.removeItem(CLAVE_GUARDADA)
  } catch {
    /* Navegación privada. La clave dura lo que dure la pantalla, y hay que
       volver a escribirla la próxima vez: molesto, pero no roto. */
  }
}

export class PublicarError extends Error {
  readonly consejo?: string
  constructor(mensaje: string, consejo?: string) {
    super(mensaje)
    this.name = 'PublicarError'
    this.consejo = consejo
  }
}

/** Qué copia de la foto: la completa, la miniatura o la de 2048 px. */
export type Variante = 'foto' | 'min' | '2k'

/**
 * Nombre de la foto de la habitación número `indice` dentro de la casa.
 *
 * Por índice y no por el id de la habitación, por lo mismo que en el `.tour`:
 * el id puede venir de un archivo importado y acabaría siendo un nombre de
 * archivo que eligió otro. Con el índice, el nombre lo elegimos siempre
 * nosotros. El Worker rechaza cualquier otra forma.
 */
export function nombreDeFoto(indice: number, variante: Variante = 'foto'): string {
  const sufijo = variante === 'foto' ? '' : `.${variante}`
  return `${String(indice).padStart(3, '0')}${sufijo}.jpg`
}

/** El logo se sube con la extensión de su tipo real; el Worker exige que coincidan. */
const EXTENSION_DE_LOGO: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export function nombreDeLogo(tipo: string): string | undefined {
  const extension = EXTENSION_DE_LOGO[tipo]
  return extension ? `logo.${extension}` : undefined
}

const LOGO_VALIDO = /^logo\.(png|jpg|webp)$/

/** La llave que genera el Worker: 26 letras de un alfabeto sin ambigüedades. */
const LLAVE_VALIDA = /^[abcdefghijkmnpqrstuvwxyz23456789]{26}$/

export function llaveValida(llave: string): boolean {
  return LLAVE_VALIDA.test(llave)
}

/** El link que se comparte. Lo abre el Worker, que rebota al visor. */
export function enlacePublico(llave: string): string {
  return `${BASE}/t/${llave}`
}

type EscenaManifiesto = {
  id: string
  name: string
  foto: string
  miniatura?: string
  foto2048?: string
  initialYaw: number
  hotspots: unknown[]
  rumbo?: number
  nivel?: { tiltX: number; tiltZ: number }
  coverageDeg?: number
}

/**
 * La marca dentro del manifiesto publicado: igual que la guardada, pero el
 * logo es el NOMBRE del archivo subido y no una llave de IndexedDB. Mismo
 * patrón que `logoArchivo` en el `.tour`, y por la misma razón.
 */
export type MarcaPublicada = Omit<MarcaGuardada, 'logoId'> & { logo?: string }

export type Manifiesto = {
  version: number
  title: string
  subtitle?: string
  startSceneId: string
  scenes: EscenaManifiesto[]
  ficha?: Ficha
  marca?: MarcaPublicada
  autogiro?: boolean
}

/**
 * Arma el manifiesto que se sube, a partir de lo guardado en el teléfono.
 *
 * Separado de la subida a propósito: es una función de datos a datos y se puede
 * probar entera sin red, sin IndexedDB y sin teléfono.
 *
 * Solo entran las habitaciones que TIENEN foto. Una sin foto se vería como una
 * esfera negra sin explicación en casa del cliente, y es mejor no enseñarla.
 *
 * `foto2048` se declara para TODAS las habitaciones: quien sube decide después,
 * foto por foto, si pudo producir la variante, y borra la declaración de las que
 * no. Así el manifiesto nunca promete un archivo que no está.
 *
 * `logo` llega de fuera porque su nombre depende del TIPO del blob, y esta
 * función no toca IndexedDB.
 */
export function armarManifiesto(tour: StoredTour, extras: { logo?: string } = {}): Manifiesto {
  const scenes: EscenaManifiesto[] = []

  for (const escena of tour.scenes) {
    if (!escena.imageId) continue
    const indice = scenes.length
    const entrada: EscenaManifiesto = {
      id: escena.id,
      name: escena.name,
      foto: nombreDeFoto(indice),
      miniatura: escena.thumbId ? nombreDeFoto(indice, 'min') : undefined,
      foto2048: nombreDeFoto(indice, '2k'),
      initialYaw: escena.initialYaw ?? 0,
      hotspots: escena.hotspots,
    }
    if (escena.rumbo !== undefined) entrada.rumbo = escena.rumbo
    if (escena.nivel) entrada.nivel = escena.nivel
    if (escena.coverageDeg !== undefined) entrada.coverageDeg = escena.coverageDeg
    scenes.push(entrada)
  }

  const ids = new Set(scenes.map((s) => s.id))

  /* Un punto que lleva a una habitación que se quedó fuera —porque no tenía
     foto— sería un botón que no hace nada. Se cae aquí, igual que hace
     `resolveTour` al abrir un recorrido local. */
  for (const escena of scenes) {
    escena.hotspots = escena.hotspots.filter((h) => {
      const punto = h as { kind?: string; to?: string }
      return punto.kind !== 'link' || (typeof punto.to === 'string' && ids.has(punto.to))
    })
  }

  const manifiesto: Manifiesto = {
    version: 2,
    title: tour.title,
    subtitle: tour.subtitle,
    startSceneId: ids.has(tour.startSceneId) ? tour.startSceneId : (scenes[0]?.id ?? ''),
    scenes,
  }

  if (tour.ficha) manifiesto.ficha = tour.ficha
  if (tour.marca) {
    /* Se copian los campos a mano y no con `const { logoId, ...resto }`: el
       object rest se compila con un helper para Safari 13 que ya costó 10 kB en
       el arranque una vez (ver `resolveTour`). */
    const m = tour.marca
    const marca: MarcaPublicada = {
      nombre: m.nombre,
      colores: m.colores,
      hudFondo: m.hudFondo,
      hudTinta: m.hudTinta,
      hudTintaSuave: m.hudTintaSuave,
      fondoApp: m.fondoApp,
      tipografia: m.tipografia,
    }
    if (extras.logo) marca.logo = extras.logo
    manifiesto.marca = marca
  }
  if (tour.autogiro === true) manifiesto.autogiro = true

  return manifiesto
}

/**
 * La misma foto a 2048 px de ancho, o `null` si este navegador no puede.
 *
 * `dispositivo.ts` ya decide que un teléfono modesto sube las texturas a 2048,
 * pero hasta aquí se bajaba la foto completa —1.5 MB— para encogerla en el
 * cliente: 1.1 MB de datos móviles tirados por cuarto, en el teléfono que menos
 * los tiene. Publicar es el momento de hacer la copia chica, una vez, y que
 * `manifiestoATour` la elija según el aparato que abre.
 *
 * `createImageBitmap` sin `resizeWidth`: con la opción, un WebKit viejo lanza
 * antes de mirar la imagen (es el mismo problema que `imageOrientation` en
 * `importar.ts`), y decodificar entera cuesta unas decenas de milisegundos, que
 * al lado de subir 1.5 MB no se notan. Si no hay `createImageBitmap` —Safari lo
 * trajo hasta iOS 15— no hay variante, y el comprador baja la completa como
 * siempre: se pierde el ahorro, no la casa.
 */
export async function variante2048(foto: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(foto)
  } catch {
    return null
  }
  try {
    if (bitmap.width <= 2048) return null
    const canvas = document.createElement('canvas')
    canvas.width = 2048
    canvas.height = Math.round((bitmap.height * 2048) / bitmap.width)
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return null
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84))
  } catch {
    return null
  } finally {
    bitmap.close()
  }
}

/**
 * Un pedido al Worker con la credencial y, si la hay, el código de rescate de la
 * llave que se está tocando. Los cuatro fallos que el Worker distingue se
 * traducen aquí a algo que una persona pueda leer y actuar.
 */
async function pedir(
  ruta: string,
  credencial: string,
  init: RequestInit = {},
  editToken?: string,
): Promise<Response> {
  let respuesta: Response
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${credencial}`,
        ...(editToken ? { 'X-Edit-Token': editToken } : {}),
      },
    })
  } catch {
    throw new PublicarError(
      'No se pudo conectar para publicar.',
      'Revisa que el teléfono tenga internet y vuelve a intentar.',
    )
  }

  if (respuesta.status === 401) {
    throw new PublicarError(
      'El código de publicación no es válido.',
      'Es el código de invitación de tu inmobiliaria, o la clave del servidor. Tócalo para escribirlo de nuevo.',
    )
  }
  if (respuesta.status === 403) {
    /* La llave existe pero no es de este teléfono: la publicó otro, o este
       recorrido se importó de un `.tour` que traía la publicación de otro. */
    throw new PublicarError(
      'Este recorrido lo publicó otro teléfono.',
      'Solo se puede volver a subir desde el teléfono que lo publicó, o con su código de rescate. Con el código de tu inmobiliaria sí puedes darlo de baja.',
    )
  }
  if (!respuesta.ok) {
    let detalle = ''
    try {
      detalle = ((await respuesta.json()) as { error?: string }).error ?? ''
    } catch {
      /* El Worker siempre contesta JSON, pero si algo se cae en medio puede
         llegar un HTML de error de Cloudflare. */
    }
    throw new PublicarError(detalle || `El servidor respondió ${respuesta.status}.`)
  }
  return respuesta
}

export type AvancePublicacion = { hechas: number; total: number }

/** Lo que hay que guardar en el teléfono para volver a tocar esta publicación. */
export type Publicado = { llave: string; editToken?: string; url: string; publicadoEn: number }

/** Una publicación que ya existe: su llave y, si este teléfono lo tiene, su código de rescate. */
export type PublicacionExistente = { llave: string; editToken?: string }

/**
 * Sube la casa y devuelve el link.
 *
 * El orden importa: primero todas las fotos, y el manifiesto AL FINAL. El
 * manifiesto es el interruptor —mientras no está, el link no abre— así que si
 * la subida se corta a la mitad, lo que queda son unas fotos sueltas que nadie
 * puede alcanzar, y no una casa a medio enseñar con cuartos en negro.
 *
 * Con `existente` se vuelve a publicar SOBRE la misma llave: el link que el
 * agente ya mandó por WhatsApp sigue sirviendo y enseña la casa nueva. Antes
 * cada "volver a subir" creaba una llave nueva y dejaba la anterior viva y
 * vieja en el servidor, sin forma de borrarla desde la interfaz.
 *
 * El `editToken` (código de rescate) lo entrega el Worker UNA vez, al crear la
 * llave, y viaja en cada pedido que la toque. Es lo que impide que un
 * compañero con el mismo código de inmobiliaria sobrescriba esta casa por
 * accidente. Vive solo en este teléfono; ver `StoredTour.publicacion`.
 */
export async function publicarTour(
  tour: StoredTour,
  credencial: string,
  alAvanzar?: (avance: AvancePublicacion) => void,
  existente?: PublicacionExistente,
): Promise<Publicado> {
  if (!sePuedePublicar()) {
    throw new PublicarError('Esta versión del visor no tiene la publicación configurada.')
  }

  /* El logo primero: su nombre va dentro del manifiesto. */
  const logo = tour.marca?.logoId ? await getImage(tour.marca.logoId) : null
  const nombreLogo = logo ? nombreDeLogo(logo.type) : undefined

  const manifiesto = armarManifiesto(tour, { logo: nombreLogo })
  if (manifiesto.scenes.length === 0) {
    throw new PublicarError(
      'Este recorrido no tiene ninguna habitación con foto.',
      'Agrega al menos una y vuelve a intentar.',
    )
  }

  const conFoto = tour.scenes.filter((e) => e.imageId)
  // Cada habitación son hasta tres archivos; el logo, uno más.
  const total = manifiesto.scenes.reduce((n, e) => n + 2 + (e.miniatura ? 1 : 0), 0) + (nombreLogo ? 1 : 0)
  let hechas = 0
  const avanzar = () => {
    hechas++
    alAvanzar?.({ hechas, total })
  }

  let llave = existente?.llave ?? ''
  let editToken = existente?.editToken
  if (!llave) {
    const nuevo = (await pedir('/api/nuevo', credencial, { method: 'POST' }).then((r) => r.json())) as {
      llave: string
      editToken?: string
    }
    llave = nuevo.llave
    editToken = typeof nuevo.editToken === 'string' ? nuevo.editToken : undefined
  }
  if (!llaveValida(llave)) {
    throw new PublicarError('El servidor devolvió una llave que no se entiende.')
  }

  const subir = async (blob: Blob, archivo: string, tipo = 'image/jpeg') => {
    await pedir(
      `/api/subir/${llave}/${archivo}`,
      credencial,
      { method: 'PUT', body: blob, headers: { 'Content-Type': tipo } },
      editToken,
    )
    avanzar()
  }

  for (let i = 0; i < manifiesto.scenes.length; i++) {
    const escena = manifiesto.scenes[i]
    const guardada = conFoto[i]
    const foto = await getImage(guardada.imageId)
    if (!foto) {
      throw new PublicarError(
        'Falta una de las fotos en el teléfono.',
        'Abre el recorrido para ver qué habitación quedó sin foto.',
      )
    }
    await subir(foto, escena.foto)

    if (escena.miniatura && guardada.thumbId) {
      const mini = await getImage(guardada.thumbId)
      if (mini) await subir(mini, escena.miniatura)
      else delete escena.miniatura
    }

    /* La variante chica es opcional: si este navegador no la puede hacer, la
       habitación se publica solo con la completa y el manifiesto no la promete. */
    const chica = await variante2048(foto)
    if (chica && escena.foto2048) await subir(chica, escena.foto2048)
    else {
      delete escena.foto2048
      avanzar()
    }
  }

  if (logo && nombreLogo) await subir(logo, nombreLogo, logo.type)

  const { url } = (await pedir(
    `/api/publicar/${llave}`,
    credencial,
    { method: 'PUT', body: JSON.stringify(manifiesto), headers: { 'Content-Type': 'application/json' } },
    editToken,
  ).then((r) => r.json())) as { url: string }

  return { llave, editToken, url: url || enlacePublico(llave), publicadoEn: Date.now() }
}

/**
 * Baja la casa: el link deja de abrir y las fotos se borran del servidor.
 *
 * Sin `editToken` también puede funcionar: el código de la inmobiliaria que la
 * publicó sirve de llave maestra para DAR DE BAJA (es la salida cuando se
 * perdió el teléfono), y la clave del servidor baja cualquiera.
 */
export async function despublicar(llave: string, credencial: string, editToken?: string): Promise<void> {
  if (!llaveValida(llave)) throw new PublicarError('Esa llave no tiene forma de llave.')
  await pedir(`/api/publicar/${llave}`, credencial, { method: 'DELETE' }, editToken)
}

/** Lo que devuelve `GET /api/m/<llave>`: el resumen más cuántos paquetes lo forman. */
export type ResumenDeVisitas = Resumen & { paquetes: number; completos: boolean }

/**
 * Las visitas de una casa publicada, resumidas por el Worker.
 *
 * Pide lo mismo que dar de baja —el código de rescate, o el código de la
 * inmobiliaria que la publicó, o la clave maestra—: las visitas de una casa son
 * de quien la publicó.
 */
export async function resumenDeVisitas(
  llave: string,
  credencial: string,
  editToken?: string,
): Promise<ResumenDeVisitas> {
  if (!llaveValida(llave)) throw new PublicarError('Esa llave no tiene forma de llave.')
  const respuesta = await pedir(`/api/m/${llave}`, credencial, { method: 'GET' }, editToken)
  return (await respuesta.json()) as ResumenDeVisitas
}

export type OpcionesDeApertura = {
  /**
   * El ancho al que este aparato sube las texturas (`aparato().anchoTextura`).
   * A 2048 o menos se elige la variante chica cuando el manifiesto la trae. Sin
   * opción se toma la completa: es el valor seguro, y el que usan las pruebas.
   */
  anchoTextura?: number
}

/**
 * Convierte el manifiesto que bajó del servidor en el `Tour` que come el visor.
 *
 * Es el gemelo de `resolveTour` (./store/tours.ts): aquel resuelve llaves de
 * IndexedDB a URLs `blob:`, y este resuelve nombres de archivo a URLs del
 * Worker. De ahí para abajo el visor no sabe ni le importa de dónde salieron.
 *
 * Lee la v1 y la v2: un manifiesto viejo simplemente no trae ficha ni marca. Y
 * todo lo que trae pasa por los mismos filtros que un `.tour` ajeno, porque es
 * lo mismo: datos de una red que no se controla, que se van a pintar en el
 * teléfono de alguien que no eligió confiar en nadie.
 */
export function manifiestoATour(llave: string, crudo: unknown, opciones: OpcionesDeApertura = {}): Tour {
  if (!crudo || typeof crudo !== 'object') {
    throw new PublicarError('El recorrido publicado llegó en un formato que no se entiende.')
  }
  const m = crudo as Partial<Manifiesto>
  const base = `${BASE}/t/${llave}/fotos`
  const chica = (opciones.anchoTextura ?? 4096) <= 2048

  const scenes: TourScene[] = []
  for (const cruda of Array.isArray(m.scenes) ? m.scenes : []) {
    if (!cruda || typeof cruda !== 'object') continue
    const e = cruda as Record<string, unknown>
    if (typeof e.foto !== 'string' || !/^[0-9]{3}\.jpg$/.test(e.foto)) continue
    /* `limpiarEscena` es el filtro del `.tour`, y espera `archivo`: se le da la
       foto con ese nombre y devuelve la habitación ya saneada —yaw, puntos,
       rumbo, nivel, cobertura— con las mismas reglas. */
    const limpia = limpiarEscena({ ...e, archivo: e.foto })
    if (!limpia) continue
    const miniatura = typeof e.miniatura === 'string' && /^[0-9]{3}\.min\.jpg$/.test(e.miniatura) ? e.miniatura : undefined
    const foto2048 = typeof e.foto2048 === 'string' && /^[0-9]{3}\.2k\.jpg$/.test(e.foto2048) ? e.foto2048 : undefined
    const escena: TourScene = {
      id: limpia.id || `h${scenes.length}`,
      name: limpia.name,
      image: `${base}/${chica && foto2048 ? foto2048 : e.foto}`,
      thumbnail: miniatura ? `${base}/${miniatura}` : undefined,
      initialYaw: limpia.initialYaw,
      hotspots: limpia.hotspots,
    }
    if (limpia.rumbo !== undefined) escena.rumbo = limpia.rumbo
    if (limpia.nivel) escena.nivel = limpia.nivel
    scenes.push(escena)
  }

  if (scenes.length === 0) {
    throw new PublicarError('Este recorrido publicado no trae ninguna habitación.')
  }

  const ids = new Set(scenes.map((s) => s.id))
  const tour: Tour = {
    title: typeof m.title === 'string' ? m.title : 'Recorrido',
    subtitle: typeof m.subtitle === 'string' ? m.subtitle : undefined,
    startSceneId: m.startSceneId && ids.has(m.startSceneId) ? m.startSceneId : scenes[0].id,
    scenes,
  }

  const ficha = limpiarFicha(m.ficha)
  if (ficha) tour.ficha = ficha

  /* `limpiarMarca` ignora `logoId` a propósito (es una llave de otro teléfono) y
     no conoce `logo`; el logo publicado es un archivo del servidor y se resuelve
     aquí, con el nombre acotado a la lista que el Worker admite. */
  const marca = limpiarMarca(m.marca)
  if (marca) {
    const crudaMarca = m.marca as Record<string, unknown> | undefined
    const logo = typeof crudaMarca?.logo === 'string' && LOGO_VALIDO.test(crudaMarca.logo) ? crudaMarca.logo : undefined
    tour.marca = { ...marca, logo: logo ? `${base}/${logo}` : undefined }
  }
  if (m.autogiro === true) tour.autogiro = true

  return tour
}

/** Descarga un recorrido publicado. No pide clave: verlo es público por link. */
export async function abrirPublicado(llave: string, opciones: OpcionesDeApertura = {}): Promise<Tour> {
  if (!sePuedePublicar()) {
    throw new PublicarError('Esta versión del visor no sabe abrir recorridos publicados.')
  }
  if (!llaveValida(llave)) throw new PublicarError('Ese link no tiene forma de link de recorrido.')

  let respuesta: Response
  try {
    /* `no-cache`: el manifiesto es el INTERRUPTOR de la casa —si no está, el
       link no abre; si cambió, enseña la casa nueva— y el Worker lo sirve con
       `max-age=60`. Sin esto, el comprador que recarga justo después de que el
       agente dio de baja (o volvió a subir) seguía viendo la versión de su
       caché durante un minuto. Es un JSON de unos KB; las fotos, que son lo que
       pesa, se siguen cacheando. */
    respuesta = await fetch(`${BASE}/t/${llave}/tour.json`, { cache: 'no-cache' })
  } catch {
    throw new PublicarError(
      'No se pudo descargar el recorrido.',
      'Revisa que haya internet y vuelve a intentar.',
    )
  }

  if (respuesta.status === 404) {
    throw new PublicarError(
      'Este recorrido ya no está disponible.',
      'Puede que quien te lo compartió lo haya dado de baja.',
    )
  }
  if (!respuesta.ok) throw new PublicarError(`El servidor respondió ${respuesta.status}.`)

  return manifiestoATour(llave, await respuesta.json(), opciones)
}

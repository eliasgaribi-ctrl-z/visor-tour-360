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
 * ── La clave ────────────────────────────────────────────────────────────────
 *
 * Subir pide una clave compartida, y esa clave NO está en el paquete de la app.
 * No es descuido: este visor es un sitio estático y su JavaScript lo puede leer
 * cualquiera, así que una clave incrustada aquí sería pública el día uno. La
 * escribe la persona una vez en su teléfono y se queda en `localStorage`.
 *
 * Eso también quiere decir que la clave es tan buena como el teléfono que la
 * guarda: si se pierde un aparato, se cambia el secreto del Worker y listo.
 */

import type { Tour, TourScene } from './types'
import type { StoredTour } from './store/types'
import { getImage } from './store/tours'

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

/**
 * Nombre de la foto de la habitación número `indice` dentro de la casa.
 *
 * Por índice y no por el id de la habitación, por lo mismo que en el `.tour`:
 * el id puede venir de un archivo importado y acabaría siendo un nombre de
 * archivo que eligió otro. Con el índice, el nombre lo elegimos siempre
 * nosotros. El Worker rechaza cualquier otra forma.
 */
export function nombreDeFoto(indice: number, miniatura = false): string {
  return `${String(indice).padStart(3, '0')}${miniatura ? '.min' : ''}.jpg`
}

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
  initialYaw: number
  hotspots: unknown[]
}

export type Manifiesto = {
  version: number
  title: string
  subtitle?: string
  startSceneId: string
  scenes: EscenaManifiesto[]
}

/**
 * Arma el manifiesto que se sube, a partir de lo guardado en el teléfono.
 *
 * Separado de la subida a propósito: es una función de datos a datos y se puede
 * probar entera sin red, sin IndexedDB y sin teléfono.
 *
 * Solo entran las habitaciones que TIENEN foto. Una sin foto se vería como una
 * esfera negra sin explicación en casa del cliente, y es mejor no enseñarla.
 */
export function armarManifiesto(tour: StoredTour): Manifiesto {
  const scenes: EscenaManifiesto[] = []

  for (const escena of tour.scenes) {
    if (!escena.imageId) continue
    const indice = scenes.length
    scenes.push({
      id: escena.id,
      name: escena.name,
      foto: nombreDeFoto(indice),
      miniatura: escena.thumbId ? nombreDeFoto(indice, true) : undefined,
      initialYaw: escena.initialYaw ?? 0,
      hotspots: escena.hotspots,
    })
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

  return {
    version: 1,
    title: tour.title,
    subtitle: tour.subtitle,
    startSceneId: ids.has(tour.startSceneId) ? tour.startSceneId : (scenes[0]?.id ?? ''),
    scenes,
  }
}

async function pedir(ruta: string, clave: string, init: RequestInit = {}): Promise<Response> {
  let respuesta: Response
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${clave}` },
    })
  } catch {
    throw new PublicarError(
      'No se pudo conectar para publicar.',
      'Revisa que el teléfono tenga internet y vuelve a intentar.',
    )
  }

  if (respuesta.status === 401) {
    throw new PublicarError(
      'La clave de publicación no es correcta.',
      'Es la misma que se configuró en el servidor. Tócala para escribirla de nuevo.',
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

/**
 * Sube la casa y devuelve el link.
 *
 * El orden importa: primero todas las fotos, y el manifiesto AL FINAL. El
 * manifiesto es el interruptor —mientras no está, el link no abre— así que si
 * la subida se corta a la mitad, lo que queda son unas fotos sueltas que nadie
 * puede alcanzar, y no una casa a medio enseñar con cuartos en negro.
 */
export async function publicarTour(
  tour: StoredTour,
  clave: string,
  alAvanzar?: (avance: AvancePublicacion) => void,
): Promise<{ llave: string; url: string }> {
  if (!sePuedePublicar()) {
    throw new PublicarError('Esta versión del visor no tiene la publicación configurada.')
  }

  const manifiesto = armarManifiesto(tour)
  if (manifiesto.scenes.length === 0) {
    throw new PublicarError(
      'Este recorrido no tiene ninguna habitación con foto.',
      'Agrega al menos una y vuelve a intentar.',
    )
  }

  const conFoto = tour.scenes.filter((e) => e.imageId)
  const total = manifiesto.scenes.reduce((n, e) => n + (e.miniatura ? 2 : 1), 0)
  let hechas = 0

  const { llave } = (await pedir('/api/nuevo', clave, { method: 'POST' }).then((r) => r.json())) as {
    llave: string
  }
  if (!llaveValida(llave)) {
    throw new PublicarError('El servidor devolvió una llave que no se entiende.')
  }

  const subir = async (id: string, archivo: string) => {
    const blob = await getImage(id)
    if (!blob) {
      throw new PublicarError(
        'Falta una de las fotos en el teléfono.',
        'Abre el recorrido para ver qué habitación quedó sin foto.',
      )
    }
    await pedir(`/api/subir/${llave}/${archivo}`, clave, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': 'image/jpeg' },
    })
    hechas++
    alAvanzar?.({ hechas, total })
  }

  for (let i = 0; i < manifiesto.scenes.length; i++) {
    const escena = manifiesto.scenes[i]
    const guardada = conFoto[i]
    await subir(guardada.imageId, escena.foto)
    if (escena.miniatura && guardada.thumbId) await subir(guardada.thumbId, escena.miniatura)
  }

  const { url } = (await pedir(`/api/publicar/${llave}`, clave, {
    method: 'PUT',
    body: JSON.stringify(manifiesto),
    headers: { 'Content-Type': 'application/json' },
  }).then((r) => r.json())) as { url: string }

  return { llave, url: url || enlacePublico(llave) }
}

/** Baja la casa: el link deja de abrir y las fotos se borran del servidor. */
export async function despublicar(llave: string, clave: string): Promise<void> {
  if (!llaveValida(llave)) throw new PublicarError('Esa llave no tiene forma de llave.')
  await pedir(`/api/publicar/${llave}`, clave, { method: 'DELETE' })
}

/**
 * Convierte el manifiesto que bajó del servidor en el `Tour` que come el visor.
 *
 * Es el gemelo de `resolveTour` (./store/tours.ts): aquel resuelve llaves de
 * IndexedDB a URLs `blob:`, y este resuelve nombres de archivo a URLs del
 * Worker. De ahí para abajo el visor no sabe ni le importa de dónde salieron.
 */
export function manifiestoATour(llave: string, crudo: unknown): Tour {
  if (!crudo || typeof crudo !== 'object') {
    throw new PublicarError('El recorrido publicado llegó en un formato que no se entiende.')
  }
  const m = crudo as Partial<Manifiesto>
  const base = `${BASE}/t/${llave}/fotos`

  const scenes: TourScene[] = (Array.isArray(m.scenes) ? m.scenes : [])
    .filter((e): e is EscenaManifiesto => Boolean(e && typeof e === 'object' && e.foto))
    .map((e) => ({
      id: e.id,
      name: e.name,
      image: `${base}/${e.foto}`,
      thumbnail: e.miniatura ? `${base}/${e.miniatura}` : undefined,
      initialYaw: e.initialYaw ?? 0,
      hotspots: (e.hotspots ?? []) as TourScene['hotspots'],
    }))

  if (scenes.length === 0) {
    throw new PublicarError('Este recorrido publicado no trae ninguna habitación.')
  }

  const ids = new Set(scenes.map((s) => s.id))
  return {
    title: typeof m.title === 'string' ? m.title : 'Recorrido',
    subtitle: typeof m.subtitle === 'string' ? m.subtitle : undefined,
    startSceneId: m.startSceneId && ids.has(m.startSceneId) ? m.startSceneId : scenes[0].id,
    scenes,
  }
}

/** Descarga un recorrido publicado. No pide clave: verlo es público por link. */
export async function abrirPublicado(llave: string): Promise<Tour> {
  if (!sePuedePublicar()) {
    throw new PublicarError('Esta versión del visor no sabe abrir recorridos publicados.')
  }
  if (!llaveValida(llave)) throw new PublicarError('Ese link no tiene forma de link de recorrido.')

  let respuesta: Response
  try {
    respuesta = await fetch(`${BASE}/t/${llave}/tour.json`)
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

  return manifiestoATour(llave, await respuesta.json())
}

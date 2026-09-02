/* oxlint-disable react/set-state-in-effect -- El efecto sincroniza con la barra
   de direcciones, que es un sistema externo. */
import { useCallback, useEffect, useState } from 'react'

/**
 * ============================================================================
 *  NAVEGACIÓN POR HASH
 * ============================================================================
 *
 * Rutas dentro del `#` y no rutas normales, porque el visor se publica como
 * sitio estático en GitHub Pages: con rutas normales, entrar directo a
 * `/editar/abc` le pediría al servidor un archivo que no existe y devolvería
 * 404. Todo lo que va después del `#` nunca llega al servidor.
 *
 *   #/                    el visor, con el recorrido activo
 *   #/inicio              mis recorridos
 *   #/editar/<id>         habitaciones de un recorrido
 *   #/capturar/<id>       tomar una panorámica con la cámara
 *   #/foto/<id>           subir una foto ya hecha
 *   #/puntos/<id>/<esc>   colocar los puntos de una habitación
 *   #/ver/<id>            ver un recorrido guardado
 *   #/p/<llave>           ver una casa PUBLICADA (vive en el servidor, no aquí)
 *   #/demo                el recorrido de ejemplo
 */

export type Ruta =
  | { nombre: 'visor' }
  | { nombre: 'inicio' }
  | { nombre: 'demo' }
  | { nombre: 'ver'; tourId: string }
  /* La única ruta que no habla con IndexedDB: el recorrido se descarga. Es la
     que recibe quien no tiene la app ni nada guardado — un cliente al que le
     pasaron un link por WhatsApp. */
  | { nombre: 'publicado'; llave: string }
  | { nombre: 'editar'; tourId: string }
  /** Con `sceneId`, la foto nueva REEMPLAZA la de esa habitación. */
  | { nombre: 'capturar'; tourId: string; sceneId?: string }
  | { nombre: 'foto'; tourId: string; sceneId?: string }
  | { nombre: 'puntos'; tourId: string; sceneId: string }

export function leerRuta(hash: string): Ruta {
  const limpio = hash.replace(/^#\/?/, '')
  const partes = limpio.split('/').filter(Boolean).map(decodeURIComponent)

  switch (partes[0]) {
    case undefined:
      return { nombre: 'visor' }
    case 'inicio':
      return { nombre: 'inicio' }
    case 'demo':
      return { nombre: 'demo' }
    case 'ver':
      return partes[1] ? { nombre: 'ver', tourId: partes[1] } : { nombre: 'inicio' }
    case 'p':
      /* Sin llave se cae al visor y no a 'inicio': quien llega por aquí suele
         venir de un link cortado por WhatsApp y no tiene nada guardado que
         enseñarle en "mis recorridos". */
      return partes[1] ? { nombre: 'publicado', llave: partes[1] } : { nombre: 'visor' }
    case 'editar':
      return partes[1] ? { nombre: 'editar', tourId: partes[1] } : { nombre: 'inicio' }
    case 'capturar':
      return partes[1]
        ? { nombre: 'capturar', tourId: partes[1], sceneId: partes[2] }
        : { nombre: 'inicio' }
    case 'foto':
      return partes[1]
        ? { nombre: 'foto', tourId: partes[1], sceneId: partes[2] }
        : { nombre: 'inicio' }
    case 'puntos':
      return partes[1] && partes[2]
        ? { nombre: 'puntos', tourId: partes[1], sceneId: partes[2] }
        : { nombre: 'inicio' }
    default:
      return { nombre: 'visor' }
  }
}

export function rutaAHash(ruta: Ruta): string {
  switch (ruta.nombre) {
    case 'visor':
      return '#/'
    case 'inicio':
      return '#/inicio'
    case 'demo':
      return '#/demo'
    case 'ver':
      return `#/ver/${encodeURIComponent(ruta.tourId)}`
    case 'publicado':
      return `#/p/${encodeURIComponent(ruta.llave)}`
    case 'editar':
      return `#/editar/${encodeURIComponent(ruta.tourId)}`
    case 'capturar':
      return (
        `#/capturar/${encodeURIComponent(ruta.tourId)}` +
        (ruta.sceneId ? `/${encodeURIComponent(ruta.sceneId)}` : '')
      )
    case 'foto':
      return (
        `#/foto/${encodeURIComponent(ruta.tourId)}` +
        (ruta.sceneId ? `/${encodeURIComponent(ruta.sceneId)}` : '')
      )
    case 'puntos':
      return `#/puntos/${encodeURIComponent(ruta.tourId)}/${encodeURIComponent(ruta.sceneId)}`
  }
}

export function useHashRoute(): { ruta: Ruta; ir: (ruta: Ruta, reemplazar?: boolean) => void } {
  const [ruta, setRuta] = useState<Ruta>(() =>
    leerRuta(typeof location === 'undefined' ? '' : location.hash),
  )

  useEffect(() => {
    const alCambiar = () => setRuta(leerRuta(location.hash))
    window.addEventListener('hashchange', alCambiar)
    return () => window.removeEventListener('hashchange', alCambiar)
  }, [])

  const ir = useCallback((destino: Ruta, reemplazar = false) => {
    const hash = rutaAHash(destino)
    if (location.hash === hash) return
    if (reemplazar) {
      // replaceState no dispara hashchange, así que hay que avisar a mano.
      history.replaceState(null, '', hash)
      setRuta(destino)
    } else {
      location.hash = hash
    }
  }, [])

  return { ruta, ir }
}

/** Recorrido que se abre al entrar al visor sin decir cuál. */
const CLAVE_ACTIVO = 'visor-tour-360:activo'

export function recorridoActivo(): string | null {
  try {
    return localStorage.getItem(CLAVE_ACTIVO)
  } catch {
    return null
  }
}

export function fijarRecorridoActivo(id: string | null) {
  try {
    if (id === null) localStorage.removeItem(CLAVE_ACTIVO)
    else localStorage.setItem(CLAVE_ACTIVO, id)
  } catch {
    // Navegación privada: no pasa nada, se abre la demo.
  }
}

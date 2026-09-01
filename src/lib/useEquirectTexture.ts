/* oxlint-disable react/set-state-in-effect -- El efecto sincroniza con un sistema
   externo (la descarga de la textura), que es exactamente su caso de uso. */
import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { aparato } from './dispositivo'
import { registrarOlvido } from './texturasVivas'

/**
 * Caché global de texturas. Volver a una habitación ya visitada es instantáneo
 * y no vuelve a descargar el JPG.
 *
 * TIENE TOPE, y no es un detalle: una equirectangular de 4096×2048 ocupa 33 MB
 * en la memoria de video, más los mipmaps. Un recorrido de ocho habitaciones
 * que precarga a sus vecinas llenaría el caché con 250 MB y el navegador de un
 * celular tira la pestaña mucho antes de eso. Se guardan las últimas usadas y
 * las demás se sueltan; volver a una vieja cuesta una recarga, que es
 * exactamente el trato correcto.
 */
const MAXIMO_EN_CACHE = 5
const cache = new Map<string, THREE.Texture>()
const loader = new THREE.TextureLoader()

/**
 * Texturas que ALGUIEN ESTÁ MOSTRANDO ahora mismo.
 *
 * Sin esta lista, precargar las habitaciones vecinas podría expulsar del caché
 * justo la que está en pantalla: la esfera se quedaría con una textura ya
 * liberada, que en la GPU se ve como un cuarto negro. Es un contador y no un
 * booleano porque el visor y el editor pueden estar mostrando la misma foto.
 */
const enUso = new Map<string, number>()

function tomar(url: string) {
  enUso.set(url, (enUso.get(url) ?? 0) + 1)
}

function soltar(url: string) {
  const cuantos = (enUso.get(url) ?? 0) - 1
  if (cuantos > 0) enUso.set(url, cuantos)
  else enUso.delete(url)
}

/** Marca una textura como la más reciente y suelta las que ya sobran. */
function refrescar(url: string, texture: THREE.Texture) {
  // Un Map recuerda el orden de inserción: reinsertar la manda al final.
  cache.delete(url)
  cache.set(url, texture)

  for (const vieja of [...cache.keys()]) {
    if (cache.size <= MAXIMO_EN_CACHE) break
    if (enUso.has(vieja)) continue
    cache.get(vieja)?.dispose()
    cache.delete(vieja)
  }
}

/**
 * Ajustes de la textura. Los usan por igual la carga normal y la precarga: si
 * la precarga guardara una versión con menos ajustes, esa peor versión sería la
 * que se quedaría en el caché, y justamente las habitaciones a las que se llega
 * por un punto son siempre precargadas.
 */
/**
 * Baja la foto a lo que este aparato puede permitirse ANTES de subirla.
 *
 * Un JPEG no ocupa en la tarjeta gráfica lo que pesa en disco: se descomprime.
 * Una equirectangular de 4096×2048 son 33 MB de memoria de video, más un tercio
 * de mipmaps. Redibujarla a 2048 la deja en 8 MB, y en un teléfono modesto —que
 * además dibuja a 1x— no se nota: a 75° de campo de visión se ve como un quinto
 * del ancho de la panorámica, o sea 410 px repartidos en una pantalla de 390.
 *
 * Se hace aquí, sobre la imagen ya decodificada, y no cambiando el formato del
 * archivo: el .tour sigue siendo un ZIP con JPEG que se abre en cualquier lado.
 */
function encoger(imagen: HTMLImageElement | ImageBitmap, ancho: number): HTMLCanvasElement | null {
  const w = 'naturalWidth' in imagen ? imagen.naturalWidth : imagen.width
  const h = 'naturalHeight' in imagen ? imagen.naturalHeight : imagen.height
  if (!w || w <= ancho) return null

  const alto = Math.max(1, Math.round((h * ancho) / w))
  const canvas = document.createElement('canvas')
  canvas.width = ancho
  canvas.height = alto
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(imagen as CanvasImageSource, 0, 0, ancho, alto)
  return canvas
}

/** Cambia la imagen de la textura por su versión reducida, si hace falta. */
function aligerar(texture: THREE.Texture) {
  const chica = encoger(texture.image as HTMLImageElement, aparato().anchoTextura)
  if (!chica) return
  // `Texture.image` está tipado como HTMLImageElement, pero WebGL sube igual
  // cualquier fuente dibujable; un canvas es una de ellas.
  texture.image = chica as unknown as HTMLImageElement
  texture.needsUpdate = true
}

function configurar(texture: THREE.Texture, gl?: THREE.WebGLRenderer) {
  // sRGB: sin esto la foto se ve lavada / con el color equivocado.
  texture.colorSpace = THREE.SRGBColorSpace
  // Repeat en horizontal: hace que la costura de 360° no se note.
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  // Anisotropía al máximo: el suelo y el techo se ven mucho menos borrosos.
  if (gl) texture.anisotropy = gl.capabilities.getMaxAnisotropy()
  texture.needsUpdate = true
}

export type TextureState = {
  texture: THREE.Texture | null
  loading: boolean
  error: boolean
}

/**
 * Carga una equirectangular de forma imperativa.
 *
 * A propósito NO usamos <Suspense> ni useLoader: durante un cambio de habitación
 * Suspense desmonta el árbol y el canvas parpadea en negro. Cargando a mano
 * podemos mantener la escena anterior en pantalla y hacer un fundido cuando
 * la nueva ya está lista.
 */
export function useEquirectTexture(url: string | null): TextureState {
  const gl = useThree((s) => s.gl)
  const [state, setState] = useState<TextureState>(() => ({
    texture: url ? (cache.get(url) ?? null) : null,
    loading: Boolean(url) && !cache.has(url ?? ''),
    error: false,
  }))

  useEffect(() => {
    if (!url) {
      setState({ texture: null, loading: false, error: false })
      return
    }

    tomar(url)

    const cached = cache.get(url)
    if (cached) {
      // La precarga pudo haberla guardado sin anisotropía, cuando todavía no
      // había un renderer a la mano.
      configurar(cached, gl)
      refrescar(url, cached)
      setState({ texture: cached, loading: false, error: false })
      return () => soltar(url)
    }

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: false }))

    loader.load(
      url,
      (texture) => {
        aligerar(texture)
        configurar(texture, gl)
        refrescar(url, texture)
        if (!cancelled) setState({ texture, loading: false, error: false })
      },
      undefined,
      () => {
        if (!cancelled) setState({ texture: null, loading: false, error: true })
      },
    )

    return () => {
      cancelled = true
      soltar(url)
    }
  }, [url, gl])

  return state
}

/**
 * Saca una textura del caché y libera su memoria de video.
 *
 * Hace falta porque el caché está indexado por URL y las URLs `blob:` de los
 * recorridos guardados en el teléfono mueren cuando se revoca el blob. Sin
 * esto quedan dos fugas al mismo tiempo: la textura vieja se queda para siempre
 * ocupando memoria de la GPU, y si alguien vuelve a pedir esa URL recibe una
 * textura que apunta a un blob que ya no existe.
 */
export function olvidarEquirect(url: string) {
  const texture = cache.get(url)
  if (!texture) return
  texture.dispose()
  cache.delete(url)
  enUso.delete(url)
}

/** Precarga en segundo plano (p.ej. la habitación vecina de un hotspot). */
export function preloadEquirect(url: string) {
  if (cache.has(url)) return
  loader.load(url, (texture) => {
    aligerar(texture)
    configurar(texture)
    refrescar(url, texture)
  })
}

/* El almacén de recorridos avisa por aquí cuando revoca una URL, sin tener que
   importar este archivo (y con él, todo three.js). Ver src/lib/texturasVivas.ts */
registrarOlvido(olvidarEquirect)

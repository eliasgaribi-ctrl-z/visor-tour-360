/* oxlint-disable react/set-state-in-effect -- El efecto sincroniza con un sistema
   externo (la descarga de la textura), que es exactamente su caso de uso. */
import { useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Caché global de texturas. Volver a una habitación ya visitada es instantáneo
 * y no vuelve a descargar el JPG.
 */
const cache = new Map<string, THREE.Texture>()
const loader = new THREE.TextureLoader()

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

    const cached = cache.get(url)
    if (cached) {
      setState({ texture: cached, loading: false, error: false })
      return
    }

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: false }))

    loader.load(
      url,
      (texture) => {
        // sRGB: sin esto la foto se ve lavada / con el color equivocado.
        texture.colorSpace = THREE.SRGBColorSpace
        // Repeat en horizontal: hace que la costura de 360° no se note.
        texture.wrapS = THREE.RepeatWrapping
        texture.wrapT = THREE.ClampToEdgeWrapping
        // Anisotropía al máximo: el suelo y el techo se ven mucho menos borrosos.
        texture.anisotropy = gl.capabilities.getMaxAnisotropy()
        texture.needsUpdate = true

        cache.set(url, texture)
        if (!cancelled) setState({ texture, loading: false, error: false })
      },
      undefined,
      () => {
        if (!cancelled) setState({ texture: null, loading: false, error: true })
      },
    )

    return () => {
      cancelled = true
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
}

/** Precarga en segundo plano (p.ej. las habitaciones vecinas del hotspot). */
export function preloadEquirect(url: string) {
  if (cache.has(url)) return
  loader.load(url, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    cache.set(url, texture)
  })
}

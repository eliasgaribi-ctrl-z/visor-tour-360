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

/**
 * Descargas en curso, para que dos pedidos de la misma foto compartan una sola.
 *
 * Antes esto era un Set que solo consultaba la precarga, y no evitaba nada:
 * la precarga de una vecina y la entrada del visitante a esa misma habitación
 * salen con milisegundos de diferencia, así que la segunda no encontraba nada
 * en el caché —todavía no llegaba— y se bajaba el megabyte otra vez, con su
 * segunda decodificación de 33 MB encima. Guardando la PROMESA, el que llega
 * tarde se cuelga de la que ya está en vuelo y los dos terminan con la MISMA
 * textura.
 *
 * Que sea la misma tiene una consecuencia que hay que tener presente en todo
 * este archivo: ninguno de los dos puede destruirla por su cuenta al cancelar,
 * porque se la estaría tumbando al otro y su habitación saldría negra.
 */
const enVuelo = new Map<string, Promise<THREE.Texture>>()

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

/**
 * Suelta una textura del todo: la memoria de video Y la de la CPU.
 *
 * `dispose()` solo avisa a three que libere lo que subió a la tarjeta gráfica.
 * El ImageBitmap del que salió sigue vivo aparte —otros 33 MB de mapa de bits,
 * fuera del montón de JavaScript, que el recolector de basura no tiene prisa
 * por tirar porque desde su punto de vista es un objeto diminuto—. Cerrarlo es
 * explícito o no pasa.
 *
 * Ojo con dónde se llama: esto solo vale para texturas que NADIE está
 * mostrando. `dispose()` a solas es recuperable, porque three vuelve a subir la
 * imagen la próxima vez que la dibuja; un bitmap cerrado no se recupera con
 * nada, y al desmontar la escena se fuerza a propósito la pérdida del contexto
 * WebGL (ver Escena360), justo el momento en que three necesita la fuente para
 * volver a subirlo todo. Cerrar el bitmap de una textura viva deja la
 * habitación en negro sin vuelta atrás.
 */
function liberar(texture: THREE.Texture) {
  const fuente = texture.image as unknown
  texture.dispose()
  if (typeof ImageBitmap !== 'undefined' && fuente instanceof ImageBitmap) fuente.close()
}

/** Marca una textura como la más reciente y suelta las que ya sobran. */
function refrescar(url: string, texture: THREE.Texture) {
  // Un Map recuerda el orden de inserción: reinsertar la manda al final.
  cache.delete(url)
  cache.set(url, texture)

  for (const vieja of [...cache.keys()]) {
    if (cache.size <= MAXIMO_EN_CACHE) break
    if (enUso.has(vieja)) continue
    const textura = cache.get(vieja)
    if (textura) liberar(textura)
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
 * ============================================================================
 *  DECODIFICAR FUERA DEL HILO PRINCIPAL
 * ============================================================================
 *
 * Medido en un celular de gama media (CPU limitada 4x): cambiar de habitación
 * congelaba la pantalla **900 ms**. No era la descarga —el JPEG pesa un
 * megabyte— sino DECODIFICARLO: convertir 4096×2048 píxeles comprimidos en 33 MB
 * de mapa de bits, y hacerlo en el mismo hilo que dibuja la interfaz.
 *
 * `createImageBitmap` lo hace en otro hilo y de paso puede REDUCIR la imagen
 * mientras la decodifica, que es justo lo que hace falta en un teléfono modesto.
 *
 * ── El detalle que puede dejar la panorámica de cabeza ─────────────────────
 *
 * WebGL sube las imágenes al revés de como las lee una etiqueta <img>, y three
 * lo compensa con `flipY`. Pero `flipY` NO funciona con un ImageBitmap: el
 * navegador lo ignora. La forma correcta es pedirle el volteo al propio
 * `createImageBitmap` (`imageOrientation: 'flipY'`) y decirle a three que ya no
 * lo haga.
 *
 * El problema es que esa opción no está en todos los navegadores, y si se
 * ignora en silencio la panorámica sale al revés — un error que no truena, solo
 * queda mal. Así que NO se supone: se prueba una vez, con una imagen de dos
 * píxeles de la que se conoce el resultado. Si el navegador no la respeta, se
 * usa el camino de siempre con una etiqueta <img>.
 */

let soportaVolteo: Promise<boolean> | null = null

function probarVolteo(): Promise<boolean> {
  if (soportaVolteo) return soportaVolteo

  soportaVolteo = (async () => {
    if (typeof createImageBitmap !== 'function') return false
    try {
      const prueba = document.createElement('canvas')
      prueba.width = 1
      prueba.height = 2
      const ctx = prueba.getContext('2d')
      if (!ctx) return false
      ctx.fillStyle = '#ff0000'
      ctx.fillRect(0, 0, 1, 1) // arriba: rojo
      ctx.fillStyle = '#0000ff'
      ctx.fillRect(0, 1, 1, 1) // abajo: azul

      const bitmap = await createImageBitmap(prueba, { imageOrientation: 'flipY' })
      const lectura = document.createElement('canvas')
      lectura.width = 1
      lectura.height = 2
      const lctx = lectura.getContext('2d', { willReadFrequently: true })
      if (!lctx) return false
      lctx.drawImage(bitmap, 0, 0)
      bitmap.close()

      // Si el volteo se aplicó, arriba tiene que estar ahora el AZUL.
      const arriba = lctx.getImageData(0, 0, 1, 1).data
      return arriba[2] > 200 && arriba[0] < 60
    } catch {
      return false
    }
  })()

  return soportaVolteo
}

/**
 * Baja la foto a lo que este aparato puede permitirse.
 *
 * Un JPEG no ocupa en la tarjeta gráfica lo que pesa en disco: se descomprime.
 * Una equirectangular de 4096×2048 son 33 MB de memoria de video, más un tercio
 * de mipmaps. Dejarla en 2048 la baja a 8 MB, y en un teléfono modesto —que
 * además dibuja a 1x— no se nota: a 75° de campo de visión se ve como un quinto
 * del ancho de la panorámica, o sea 410 px repartidos en una pantalla de 390.
 *
 * Se hace sobre la imagen ya decodificada y no cambiando el formato del archivo:
 * el .tour sigue siendo un ZIP con JPEG que se abre en cualquier lado.
 */
function encoger(imagen: HTMLImageElement, ancho: number): HTMLCanvasElement | null {
  const w = imagen.naturalWidth
  const h = imagen.naturalHeight
  if (!w || w <= ancho) return null

  const alto = Math.max(1, Math.round((h * ancho) / w))
  const canvas = document.createElement('canvas')
  canvas.width = ancho
  canvas.height = alto
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(imagen, 0, 0, ancho, alto)
  return canvas
}

/** El camino de respaldo: etiqueta <img>, con la decodificación pedida aparte. */
async function cargarConImg(url: string): Promise<THREE.Texture> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url
  // `decode()` hace el trabajo pesado antes de que nadie intente dibujarla;
  // sin esto, la primera vez que WebGL la toca se decodifica de golpe.
  await img.decode()

  const chica = encoger(img, aparato().anchoTextura)
  const texture = new THREE.Texture((chica ?? img) as unknown as HTMLImageElement)
  texture.flipY = true
  texture.needsUpdate = true
  return texture
}

/** El camino bueno: decodificar y reducir en otro hilo. */
async function cargarConBitmap(url: string): Promise<THREE.Texture> {
  const respuesta = await fetch(url)
  if (!respuesta.ok) throw new Error(`No se pudo bajar la panorámica (${respuesta.status})`)
  const blob = await respuesta.blob()

  const ancho = aparato().anchoTextura
  let bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY' })

  if (bitmap.width > ancho) {
    const alto = Math.max(1, Math.round((bitmap.height * ancho) / bitmap.width))
    const reducido = await createImageBitmap(bitmap, {
      resizeWidth: ancho,
      resizeHeight: alto,
      resizeQuality: 'high',
    })
    bitmap.close()
    bitmap = reducido
  }

  const texture = new THREE.Texture(bitmap as unknown as HTMLImageElement)
  // El volteo ya lo hizo createImageBitmap; que three no lo repita.
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

/** Carga una equirectangular por el mejor camino que este navegador permita. */
async function cargarTextura(url: string): Promise<THREE.Texture> {
  if (await probarVolteo()) {
    try {
      return await cargarConBitmap(url)
    } catch {
      // Un fetch que falla por CORS, o un blob que ya se revocó: se reintenta
      // por el camino viejo antes de darse por vencido.
    }
  }
  return cargarConImg(url)
}

function configurar(texture: THREE.Texture, gl?: THREE.WebGLRenderer) {
  // Anisotropía al máximo: el suelo y el techo se ven mucho menos borrosos.
  const aniso = gl ? gl.capabilities.getMaxAnisotropy() : texture.anisotropy

  /* Salir temprano si ya está lista NO es una micro-optimización: esta función
     también corre al reentrar a una habitación que ya está en el caché, y
     `needsUpdate = true` obliga a three a volver a subir la textura entera a la
     tarjeta gráfica. Son 33 MB por cada vez que el visitante va y vuelve entre
     dos cuartos, con su tirón correspondiente.

     La anisotropía TIENE que entrar en la comparación: three solo la programa
     mientras SUBE la textura, así que una precargada —que se guarda sin
     renderer a la mano, o sea con anisotropía 1— nunca la recibiría, y el suelo
     y el techo se quedarían borrosos para siempre. Y a las habitaciones a las
     que se llega por un punto siempre se llega precargadas. */
  if (
    texture.colorSpace === THREE.SRGBColorSpace &&
    texture.wrapS === THREE.RepeatWrapping &&
    texture.wrapT === THREE.ClampToEdgeWrapping &&
    texture.anisotropy === aniso
  ) {
    return
  }

  // sRGB: sin esto la foto se ve lavada / con el color equivocado.
  texture.colorSpace = THREE.SRGBColorSpace
  // Repeat en horizontal: hace que la costura de 360° no se note.
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = aniso
  // Algo cambió de verdad: que three la vuelva a subir con los ajustes buenos.
  texture.needsUpdate = true
}

/** Una sola descarga por URL, compartida por todos los que la pidan a la vez. */
function cargarUnaVez(url: string): Promise<THREE.Texture> {
  const yaVenia = enVuelo.get(url)
  if (yaVenia) return yaVenia
  const promesa = cargarTextura(url).finally(() => enVuelo.delete(url))
  enVuelo.set(url, promesa)
  return promesa
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

    cargarUnaVez(url)
      .then((texture) => {
        /* Cancelado: nos fuimos de la habitación antes de que llegara la foto.
           Se sale y ya. NO se destruye la textura: es compartida, y muy
           probablemente el que la sigue esperando es la precarga de la vecina
           o la otra vista montada sobre la misma URL. Tumbársela dejaría su
           cuarto en negro. Si de verdad no la quiere nadie, se queda sin entrar
           al caché y el recolector se la lleva. */
        if (cancelled) return
        configurar(texture, gl)
        refrescar(url, texture)
        setState({ texture, loading: false, error: false })
      })
      .catch(() => {
        if (!cancelled) setState({ texture: null, loading: false, error: true })
      })

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
  cache.delete(url)
  /* Si todavía hay una esfera mostrándola, se suelta la memoria de video pero
     el bitmap se deja abierto: three puede volver a subirlo si el contexto se
     pierde y se restaura, y cerrarlo aquí dejaría ese cuarto negro hasta que
     alguien cambie de habitación. */
  if (enUso.has(url)) texture.dispose()
  else liberar(texture)
  enUso.delete(url)
}

/** Precarga en segundo plano (p.ej. la habitación vecina de un hotspot). */
export function preloadEquirect(url: string) {
  if (cache.has(url) || enVuelo.has(url)) return
  void cargarUnaVez(url)
    .then((texture) => {
      /* Mientras se bajaba, alguien pudo entrar a esa habitación y guardarla.
         Como la descarga es compartida, la que está en el caché es ESTA MISMA
         textura: destruirla aquí sería apagarle la foto al visitante que la
         está viendo. Se deja como está y listo. */
      if (cache.has(url)) return
      configurar(texture)
      refrescar(url, texture)
    })
    .catch(() => undefined)
}

/* El almacén de recorridos avisa por aquí cuando revoca una URL, sin tener que
   importar este archivo (y con él, todo three.js). Ver src/lib/texturasVivas.ts */
registrarOlvido(olvidarEquirect)

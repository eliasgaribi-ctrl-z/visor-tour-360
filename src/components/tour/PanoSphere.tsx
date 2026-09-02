/* oxlint-disable react/set-state-in-effect -- Commit del fundido: el estado nuevo
   depende de una textura que terminó de cargar fuera de React. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useEquirectTexture } from '../../lib/useEquirectTexture'
import { useMenosMovimiento } from '../../lib/menosMovimiento'
import { cuaternionDeNivel, type Nivel } from '../../lib/nivel'

/**
 * Rotación inicial de la esfera.
 *
 * SphereGeometry coloca u = 0 en el eje -X. Con la cámara mirando hacia -Z en
 * yaw = 0, el centro de la foto caería en u = 0.75 (girado 90°). Empezando la
 * esfera en φ = π/2 el centro horizontal de la equirectangular queda justo al
 * frente cuando yaw = 0, que es lo que cualquiera espera al montar la escena.
 */
const PHI_START = Math.PI / 2

export type PanoSphereProps = {
  url: string
  /** Corrección de nivel de ESTA foto. Ver src/lib/nivel.ts. */
  nivel?: Nivel
  radius?: number
  /**
   * Duración del fundido al cambiar de habitación, en segundos. En cero el
   * cambio es instantáneo, que es lo que se hace con "reducir movimiento".
   */
  fadeSeconds?: number
  onLoadingChange?: (loading: boolean) => void
  onError?: () => void
}

/**
 * Fundido corto para quien pidió menos movimiento.
 *
 * El proyecto ya respeta `prefers-reduced-motion` en otros dos lugares —el aro
 * de los enlaces deja de latir (`src/index.css`) y `rendimiento.mjs` lo
 * verifica— pero el fundido entre habitaciones era el único que seguía durando
 * lo mismo para todo el mundo. Un cambio de imagen a pantalla completa es
 * justamente el tipo de movimiento que molesta a quien activó ese ajuste.
 *
 * No se pone en cero: un corte seco deja un frame en negro si la textura nueva
 * todavía no está lista, que es el problema que el fundido existe para evitar.
 * 120 ms es suficiente para cubrirlo y ya no se lee como una animación.
 *
 * La respuesta se consulta con `useMenosMovimiento`, que la lee una vez y la
 * mantiene al día con un listener. La primera versión de esto llamaba a
 * `matchMedia()` dentro del `useFrame`: sesenta veces por segundo, construyendo
 * un `MediaQueryList` nuevo cada vez, en el único lugar del proyecto donde la
 * regla es no trabajar por cuadro. Ver `src/lib/menosMovimiento.ts`.
 */
const FUNDIDO_REDUCIDO = 0.12

/**
 * La esfera que envuelve a la cámara.
 *
 * ── scale={[-1, 1, 1]} + BackSide ──────────────────────────────────────────
 * Sin el espejo en X, la foto se vería invertida: girar a la derecha mostraría
 * lo que está a la izquierda de la panorámica (los letreros salen al revés).
 * Con la escala negativa la geometría se voltea, y three.js compensa el sentido
 * de las caras al detectar el determinante negativo — por eso el material sigue
 * necesitando BackSide para ser visible desde adentro.
 *
 * ── El fundido ─────────────────────────────────────────────────────────────
 * Dos esferas: la de abajo con la habitación actual y otra encima, transparente,
 * con la que está entrando. Cuando la opacidad llega a 1, la nueva pasa a ser la
 * base y la de encima se desmonta. Así nunca hay un frame en negro.
 *
 * Las dos tienen el MISMO radio, y el orden de dibujo lo fija `renderOrder` con
 * `depthTest` apagado en la entrante, no un radio menor. Antes la entrante medía
 * `radius * 0.98`, y con la cámara en el centro exacto eso no cambiaba ni un
 * píxel: la proyección de un punto depende solo de su dirección, no de su
 * distancia. Pero el empuje de `CameraRig` saca la cámara del centro durante el
 * fundido, y con la cámara descentrada dos esferas de radios distintos SÍ
 * proyectan distinto: la misma pared aparecía en dos sitios a la vez mientras las
 * fotos se mezclaban. Con radios iguales, las dos se mueven juntas.
 */
export function PanoSphere({
  url,
  nivel,
  radius = 500,
  /* Con "reducir movimiento" encendido el fundido se apaga: un cuarto entero
     que se desvanece encima de otro es justo el tipo de imagen que marea a
     quien pidió ese ajuste. Se pregunta en cada render y no una sola vez
     porque el ajuste se puede cambiar con la aplicación abierta. */
  fadeSeconds = 0.55,
  onLoadingChange,
  onError,
}: PanoSphereProps) {
  const { texture, loading, error } = useEquirectTexture(url)
  const invalidate = useThree((s) => s.invalidate)
  const menosMovimiento = useMenosMovimiento()

  /* Cada esfera lleva SU nivel, no uno compartido: durante el fundido conviven
     la foto vieja y la nueva, y cada una necesita el suyo. Con un solo nivel para
     las dos, cambiar de habitación aplicaba el nivel nuevo a la foto vieja
     durante medio segundo. Por eso el estado guarda la textura junto con el
     nivel con el que se mostró, y el nivel de la entrante se congela al
     empezar el fundido. */
  const [base, setBase] = useState<{ texture: THREE.Texture; nivel?: Nivel } | null>(null)
  const [incoming, setIncoming] = useState<{ texture: THREE.Texture; nivel?: Nivel } | null>(null)
  const fade = useRef(0)
  const overlayMaterial = useRef<THREE.MeshBasicMaterial>(null)
  /* El nivel vigente, para leerlo desde el efecto de la textura sin meterlo en
     sus dependencias: ese efecto arranca un fundido, y un cambio de nivel no
     debe arrancar ninguno. Se escribe en un efecto y no durante el render —la
     regla de refs de este proyecto— y va declarado ANTES del efecto que lo lee,
     porque los efectos corren en orden de declaración: cuando textura y nivel
     cambian en el mismo commit (al cambiar de habitación), el ref ya está al
     día cuando la textura llega. */
  const nivelRef = useRef(nivel)
  useEffect(() => {
    nivelRef.current = nivel
    /* Y ajustar el nivel en el editor mueve la esfera con la cámara quieta: hay
       que pedir cuadro, o el cambio se queda sin pintar hasta que alguien la
       mueva. La foto que ya está de base sigue al nivel en vivo. */
    invalidate()
  }, [nivel, invalidate])

  useEffect(() => {
    onLoadingChange?.(loading)
  }, [loading, onLoadingChange])

  useEffect(() => {
    if (error) onError?.()
  }, [error, onError])

  useEffect(() => {
    if (!texture) return

    if (texture === base?.texture) {
      /* Volvimos a la habitación que ya está abajo mientras entraba otra: pasa
         al tocar un punto y arrepentirse enseguida, o al ir y volver por el
         historial. Hay que abortar el fundido en curso, porque si se deja
         corriendo el useFrame lo lleva hasta 1 y promueve a base la habitación
         EQUIVOCADA: la pantalla se queda en el cuarto del que ya nos fuimos. */
      if (incoming) {
        setIncoming(null)
        fade.current = 0
        invalidate()
      }
      return
    }

    // El canvas dibuja a pedido: una foto nueva es justamente un motivo.
    invalidate()
    if (base === null) {
      // Primera carga: no hay de dónde venir, se muestra directo.
      setBase({ texture, nivel: nivelRef.current })
      return
    }
    // Ya la estamos fundiendo. Este efecto vuelve a correr cada vez que cambia
    // `incoming`, y reiniciar `fade` aquí dejaría el fundido dando vueltas.
    if (texture === incoming?.texture) return
    fade.current = 0
    setIncoming({ texture, nivel: nivelRef.current })
  }, [texture, base, incoming, invalidate])

  useFrame((_state, delta) => {
    if (!incoming || !overlayMaterial.current) return
    /* ── El tope del delta, y por qué sin él NO HABÍA FUNDIDO ────────────────
     *
     * El MISMO tope que pone `CameraRig` (src/components/tour/CameraRig.tsx:108),
     * y por una razón hermana. El canvas dibuja A PEDIDO: con la cámara quieta no
     * se renderiza, así que R3F no llama a `clock.getDelta()`, y el PRIMER cuadro
     * después de un rato parado trae como `delta` TODO el tiempo transcurrido.
     *
     * Sin topar, ese único cuadro dividía el intervalo completo por la duración y
     * `fade` saltaba de 0 a 1 de golpe: `setBase(incoming)` y `setIncoming(null)`
     * en el mismo cuadro, o sea un CORTE SECO. Medido con el dev server: al entrar
     * a una habitación que todavía se estaba descargando llegaba un `delta` de
     * 20 118 ms; contando cuadros con las dos esferas dibujadas, el fundido
     * ocupaba 1 cuadro en vez de los ~30 que corresponden a 0.55 s.
     *
     * O sea que el fundido —que existe para que no haya un frame en negro— no
     * estaba funcionando justo cuando más hacía falta: viniendo de un visor
     * dormido, que es el caso normal.
     *
     * Con el tope de 1/10 s el fundido dura al menos 6 cuadros aunque venga de un
     * canvas parado, y 2 con `prefers-reduced-motion`. Si se cambia el valor, hay
     * que cambiarlo en los dos sitios: los dos `useFrame` de este canvas reciben
     * el mismo `delta`. */
    const dt = Math.min(delta, 1 / 10)
    const duracion = menosMovimiento.current ? FUNDIDO_REDUCIDO : fadeSeconds
    fade.current = Math.min(1, fade.current + dt / Math.max(duracion, 0.001))
    overlayMaterial.current.opacity = fade.current
    if (fade.current >= 1) {
      setBase(incoming)
      setIncoming(null)
    }
    // El fundido es una animación: mientras dure hay que seguir pidiendo cuadros,
    // y el último —el que ya no lleva la esfera de encima— también hay que pintarlo.
    invalidate()
  })

  /* La esfera de base sigue el nivel EN VIVO (es la que se ajusta en el editor);
     la entrante conserva el que traía al empezar el fundido. Rotar el <group>
     que envuelve la malla —y no la cámara— es lo que deja intactos a los
     marcadores del HUD y al rig: la cámara y los puntos siguen viviendo en el
     mundo, y una dirección d pasa a muestrear la textura en Q⁻¹·d.

     Los dos cuaterniones se MEMOIZAN, y no es cosmético: un `Quaternion` nuevo
     en cada render es, para R3F, una prop que cambió; la aplica y pide cuadro.
     Como este componente se re-renderiza con cualquier estado del visor de
     arriba —abrir una nota, retirar la pista—, cada uno de esos costaba un
     dibujo con la cámara quieta. `rendimiento.mjs` lo mide: abrir y cerrar una
     nota tiene que dar cero. Las dependencias son los dos números y no el
     objeto, para que un `nivel` recreado con los mismos valores tampoco cuente. */
  const nivelBase = incoming ? base?.nivel : nivel
  const qBase = useMemo(
    () => cuaternionDeNivel(nivelBase),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- por valor, ver arriba
    [nivelBase?.tiltX, nivelBase?.tiltZ],
  )
  const nivelEntrante = incoming?.nivel
  const qEntrante = useMemo(
    () => cuaternionDeNivel(nivelEntrante),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- por valor, ver arriba
    [nivelEntrante?.tiltX, nivelEntrante?.tiltZ],
  )

  return (
    <group>
      {base && (
        <group quaternion={qBase}>
          <mesh scale={[-1, 1, 1]} renderOrder={0}>
            <sphereGeometry args={[radius, 64, 40, PHI_START]} />
            <meshBasicMaterial map={base.texture} side={THREE.BackSide} toneMapped={false} />
          </mesh>
        </group>
      )}

      {incoming && (
        <group quaternion={qEntrante}>
          <mesh scale={[-1, 1, 1]} renderOrder={1}>
            <sphereGeometry args={[radius, 64, 40, PHI_START]} />
            <meshBasicMaterial
              ref={overlayMaterial}
              map={incoming.texture}
              side={THREE.BackSide}
              toneMapped={false}
              transparent
              opacity={0}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>
        </group>
      )}
    </group>
  )
}

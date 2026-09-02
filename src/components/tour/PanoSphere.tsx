/* oxlint-disable react/set-state-in-effect -- Commit del fundido: el estado nuevo
   depende de una textura que terminó de cargar fuera de React. */
import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useEquirectTexture } from '../../lib/useEquirectTexture'
import { menosMovimiento } from '../../lib/movimiento'

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
 * Dos esferas: la de abajo con la habitación actual y una interior, transparente,
 * con la que está entrando. Cuando la opacidad llega a 1, la nueva pasa a ser la
 * base y la de encima se desmonta. Así nunca hay un frame en negro.
 */
export function PanoSphere({
  url,
  radius = 500,
  /* Con "reducir movimiento" encendido el fundido se apaga: un cuarto entero
     que se desvanece encima de otro es justo el tipo de imagen que marea a
     quien pidió ese ajuste. Se pregunta en cada render y no una sola vez
     porque el ajuste se puede cambiar con la aplicación abierta. */
  fadeSeconds = menosMovimiento() ? 0 : 0.55,
  onLoadingChange,
  onError,
}: PanoSphereProps) {
  const { texture, loading, error } = useEquirectTexture(url)
  const invalidate = useThree((s) => s.invalidate)

  const [base, setBase] = useState<THREE.Texture | null>(null)
  const [incoming, setIncoming] = useState<THREE.Texture | null>(null)
  const fade = useRef(0)
  const overlayMaterial = useRef<THREE.MeshBasicMaterial>(null)

  useEffect(() => {
    onLoadingChange?.(loading)
  }, [loading, onLoadingChange])

  useEffect(() => {
    if (error) onError?.()
  }, [error, onError])

  useEffect(() => {
    if (!texture) return

    if (texture === base) {
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
      setBase(texture)
      return
    }
    // Ya la estamos fundiendo. Este efecto vuelve a correr cada vez que cambia
    // `incoming`, y reiniciar `fade` aquí dejaría el fundido dando vueltas.
    if (texture === incoming) return
    fade.current = 0
    setIncoming(texture)
  }, [texture, base, incoming, invalidate])

  useFrame((_state, delta) => {
    if (!incoming || !overlayMaterial.current) return

    /* En modo "a pedido" R3F entrega el delta CRUDO del reloj (solo lo tope en
       modo "never"). Después de unos segundos sin dibujar —que es lo normal
       aquí: el visor descansa en cuanto la cámara se detiene— el primer cuadro
       llega con delta ≈ 0.8 s y el fundido se salta entero de un golpe, que es
       exactamente el parpadeo que el fundido venía a evitar. Se topa en 1/10 s,
       el mismo número y por el mismo motivo que en CameraRig. */
    const dt = Math.min(delta, 1 / 10)

    fade.current = Math.min(1, fade.current + dt / Math.max(fadeSeconds, 0.001))
    overlayMaterial.current.opacity = fade.current
    if (fade.current >= 1) {
      setBase(incoming)
      setIncoming(null)
    }
    // El fundido es una animación: mientras dure hay que seguir pidiendo cuadros,
    // y el último —el que ya no lleva la esfera de encima— también hay que pintarlo.
    invalidate()
  })

  return (
    <group>
      {base && (
        <mesh scale={[-1, 1, 1]} renderOrder={0}>
          <sphereGeometry args={[radius, 64, 40, PHI_START]} />
          <meshBasicMaterial map={base} side={THREE.BackSide} toneMapped={false} />
        </mesh>
      )}

      {incoming && (
        <mesh scale={[-1, 1, 1]} renderOrder={1}>
          <sphereGeometry args={[radius * 0.98, 64, 40, PHI_START]} />
          <meshBasicMaterial
            ref={overlayMaterial}
            map={incoming}
            side={THREE.BackSide}
            toneMapped={false}
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  )
}

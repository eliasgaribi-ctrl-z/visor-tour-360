/* oxlint-disable react/set-state-in-effect -- Commit del fundido: el estado nuevo
   depende de una textura que terminó de cargar fuera de React. */
import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useEquirectTexture } from '../../lib/useEquirectTexture'
import { useMenosMovimiento } from '../../lib/menosMovimiento'

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
  /** Duración del fundido al cambiar de habitación, en segundos. */
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
 * Dos esferas: la de abajo con la habitación actual y una interior, transparente,
 * con la que está entrando. Cuando la opacidad llega a 1, la nueva pasa a ser la
 * base y la de encima se desmonta. Así nunca hay un frame en negro.
 */
export function PanoSphere({
  url,
  radius = 500,
  fadeSeconds = 0.55,
  onLoadingChange,
  onError,
}: PanoSphereProps) {
  const { texture, loading, error } = useEquirectTexture(url)
  const invalidate = useThree((s) => s.invalidate)
  const menosMovimiento = useMenosMovimiento()

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
    if (!texture || texture === base) return
    // El canvas dibuja a pedido: una foto nueva es justamente un motivo.
    invalidate()
    if (base === null) {
      // Primera carga: no hay de dónde venir, se muestra directo.
      setBase(texture)
      return
    }
    fade.current = 0
    setIncoming(texture)
  }, [texture, base, invalidate])

  useFrame((_state, delta) => {
    if (!incoming || !overlayMaterial.current) return
    const duracion = menosMovimiento.current ? FUNDIDO_REDUCIDO : fadeSeconds
    fade.current = Math.min(1, fade.current + delta / Math.max(duracion, 0.001))
    overlayMaterial.current.opacity = fade.current
    if (fade.current >= 1) {
      setBase(incoming)
      setIncoming(null)
    } else {
      // El fundido es una animación: mientras dure, hay que seguir pidiendo.
      invalidate()
    }
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

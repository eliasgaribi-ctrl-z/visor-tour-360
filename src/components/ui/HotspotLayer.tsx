import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { Hotspot } from '../../lib/types'
import { useTourEngine } from '../../lib/tourEngine'
import { DEG, yawPitchToVector3 } from '../../lib/math'

export type HotspotLayerProps = {
  hotspots: Hotspot[]
  onSelect: (hotspot: Hotspot) => void
}

/**
 * ============================================================================
 *  HOTSPOTS: DOM DE VERDAD, PEGADO A LA ESCENA 3D
 * ============================================================================
 *
 * Los marcadores NO viven dentro del <Canvas>: son <button> normales en la capa
 * de overlay. El pulso compartido del HUD proyecta cada dirección (yaw, pitch)
 * a coordenadas de pantalla y les escribe el transform. Cuando la cámara se
 * detiene, el pulso se apaga y los marcadores dejan de recalcularse.
 *
 * Ventajas de hacerlo así en lugar de meterlos al 3D:
 *   · se estilizan con Tailwind como cualquier botón (y así se ven "de app",
 *     no "de WebGL"),
 *   · el texto sale nítido en pantallas retina, sin texturas,
 *   · reciben el click sin pelearse con el arrastre para mirar alrededor,
 *   · cero renders de React mientras la cámara se mueve.
 *
 * La proyección es la misma que hace la cámara, hecha a mano:
 *   1. se rota la dirección del hotspot al espacio de la cámara (inversa de su
 *      rotación, que el CameraRig publica como yaw/pitch),
 *   2. si queda detrás (z >= 0, porque la cámara mira hacia -Z) se esconde,
 *   3. división perspectiva con la distancia focal f = 1 / tan(fov/2).
 */
export function HotspotLayer({ hotspots, onSelect }: HotspotLayerProps) {
  const engine = useTourEngine()
  const containerRef = useRef<HTMLDivElement>(null)
  const nodes = useRef(new Map<string, HTMLElement>())

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // El tamaño se cachea con ResizeObserver: leerlo en cada frame justo
    // después de escribir transforms forzaría un reflow por frame.
    let width = container.clientWidth
    let height = container.clientHeight
    /* Al cambiar de tamaño hay que TOCAR EL TIMBRE, no solo anotar la medida.
       El pulso del HUD se duerme cuando la cámara está quieta, y la primera
       medición llega justo después de montar: sin este aviso, los marcadores se
       quedaban sin colocar —invisibles en la esquina— hasta que el usuario
       moviera la cámara. */
    const observer = new ResizeObserver(() => {
      width = container.clientWidth
      height = container.clientHeight
      engine.invalidar()
    })
    observer.observe(container)

    const direction = new THREE.Vector3()
    const euler = new THREE.Euler(0, 0, 0, 'YXZ')
    const quaternion = new THREE.Quaternion()

    const desuscribir = engine.suscribirHud(() => {
      if (!width || !height) return

      const { yaw, pitch, fov } = engine.readout
      const aspect = width / height
      const focal = 1 / Math.tan((fov * DEG) / 2)

      // Inversa de la orientación de la cámara (mismo Euler que el CameraRig).
      euler.set(pitch * DEG, -yaw * DEG, 0, 'YXZ')
      quaternion.setFromEuler(euler).invert()

      for (const hotspot of hotspots) {
        const node = nodes.current.get(hotspot.id)
        if (!node) continue

        yawPitchToVector3(hotspot.yaw, hotspot.pitch, 1, direction).applyQuaternion(quaternion)

        // Detrás de la cámara (o casi al ras): fuera.
        if (direction.z > -0.05) {
          if (node.style.visibility !== 'hidden') {
            node.style.visibility = 'hidden'
            node.style.opacity = '0'
          }
          continue
        }

        const ndcX = (direction.x / -direction.z) * (focal / aspect)
        const ndcY = (direction.y / -direction.z) * focal
        const x = (ndcX * 0.5 + 0.5) * width
        const y = (1 - (ndcY * 0.5 + 0.5)) * height

        node.style.visibility = 'visible'
        node.style.opacity = '1'
        node.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`
      }
    })

    return () => {
      desuscribir()
      observer.disconnect()
    }
    // `hotspots` en las dependencias no es de adorno: al cambiar de habitación
    // hay que volver a suscribirse (y eso toca el timbre) para colocar los
    // marcadores nuevos, que si no se quedarían invisibles.
  }, [engine, hotspots])

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 overflow-hidden">
      {hotspots.map((hotspot) => (
        <button
          key={hotspot.id}
          type="button"
          data-no-drag
          ref={(node) => {
            if (node) nodes.current.set(hotspot.id, node)
            else nodes.current.delete(hotspot.id)
          }}
          onClick={() => onSelect(hotspot)}
          style={{ visibility: 'hidden', opacity: 0 }}
          className="pointer-events-auto absolute left-0 top-0 flex items-center gap-2 rounded-full
                     bg-black/45 py-2 pl-2 pr-4 text-sm font-medium text-white
                     ring-1 ring-white/25 backdrop-blur-sm transition-[opacity,background-color]
                     duration-150 will-change-transform hover:bg-black/65 active:scale-95"
        >
          <span
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] ${
              hotspot.kind === 'link' ? 'bg-brand-500 text-black' : 'bg-white/85 text-black'
            }`}
          >
            {hotspot.kind === 'link' ? '→' : 'i'}
          </span>
          <span className="whitespace-nowrap drop-shadow">{hotspot.label}</span>
          {hotspot.kind === 'link' && (
            <span className="absolute -inset-1 -z-10 animate-ping rounded-full bg-brand-500/20" />
          )}
        </button>
      ))}
    </div>
  )
}

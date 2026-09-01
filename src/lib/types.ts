/**
 * Modelo de datos del recorrido.
 *
 * Convención de ángulos usada en TODO el proyecto (grados, no radianes):
 *   yaw   →  rotación horizontal. 0 = frente inicial de la escena.
 *            Positivo = girar a la DERECHA.
 *   pitch →  inclinación vertical. 0 = horizonte.
 *            Positivo = mirar HACIA ARRIBA. Se limita a ±85° para no llegar al polo.
 */

export type Hotspot = {
  id: string
  /** Dirección del marcador dentro de la esfera. */
  yaw: number
  pitch: number
  /** Texto corto que se muestra en la burbuja. */
  label: string
} & (
  | {
      /** Salta a otra escena del recorrido. */
      kind: 'link'
      /** id de la escena destino. */
      to: string
      /** Hacia dónde queda viendo la cámara al llegar. Default: initialYaw de la escena. */
      arriveYaw?: number
    }
  | {
      /** Solo informativo: abre un panel, no navega. */
      kind: 'info'
      body?: string
    }
)

export type TourScene = {
  id: string
  name: string
  /** Ruta a la equirectangular 2:1 (relativa a /public). */
  image: string
  /** Miniatura opcional para la barra inferior. */
  thumbnail?: string
  /** Yaw al entrar por primera vez a la escena. Default 0. */
  initialYaw?: number
  hotspots: Hotspot[]
}

export type Tour = {
  title: string
  subtitle?: string
  startSceneId: string
  scenes: TourScene[]
}

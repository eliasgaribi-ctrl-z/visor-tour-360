/* oxlint-disable react/refs -- useCreateTourEngine usa el patrón estándar de
   inicialización perezosa de un ref; el valor no participa en el render. */
import { createContext, useContext, useRef } from 'react'

/**
 * ============================================================================
 *  EL PUENTE ENTRE LA UI Y LA CÁMARA
 * ============================================================================
 *
 * Un joystick emite ~120 eventos por segundo. Si cada uno pasara por
 * useState, React re-renderizaría el árbol entero 120 veces por segundo
 * y el visor se arrastraría en un celular de gama media.
 *
 * En lugar de eso usamos un objeto MUTABLE compartido:
 *
 *   Joystick / arrastre / zoom  ──escriben──▶  LookInput  ──lee──▶  CameraRig
 *                                                (ref)              (useFrame)
 *
 *   CameraRig ──escribe cada frame──▶ CameraReadout ──lee (rAF propio)──▶ Brújula / HUD
 *
 * Cero renders de React durante el movimiento. Los únicos re-renders reales
 * son los cambios de habitación y los estados visuales (joystick activo, etc).
 */

/** Lo que la UI le pide a la cámara. El CameraRig lo consume cada frame. */
export type LookInput = {
  /**
   * Eje continuo del joystick, ya normalizado a [-1, 1].
   *   x: +1 = girar a la derecha
   *   y: +1 = mirar hacia arriba   (ojo: la pantalla tiene la Y al revés,
   *                                 el Joystick ya hace la inversión)
   * Se interpreta como VELOCIDAD angular, no como posición.
   */
  axis: { x: number; y: number }

  /**
   * Deltas de un solo uso, en GRADOS, que acumulan el arrastre con el dedo/mouse.
   * El CameraRig los suma y los pone en 0 al terminar el frame.
   */
  dragYaw: number
  dragPitch: number

  /** Delta de zoom de un solo uso, en grados de FOV (rueda o pellizco). */
  dFov: number

  /**
   * FOV ABSOLUTO de destino, en grados. Un solo uso: el rig lo toma, lo fija como
   * objetivo y lo pone en null.
   *
   * Existe aparte de `dFov` porque los dos resuelven problemas distintos, y
   * confundirlos era un bug de verdad. `dFov` es un delta y sirve para los gestos
   * continuos (rueda, pellizco): cada evento empuja un poco más y el usuario ve el
   * resultado mientras lo hace, así que un error se autocorrige en el evento
   * siguiente.
   *
   * "Reencuadrar" no es así: es un disparo único que tiene que aterrizar en un
   * valor EXACTO. Expresarlo como delta obliga a quien llama a restar el FOV
   * actual… y el único FOV que la UI puede leer es `readout.fov`, que es el
   * SUAVIZADO y va por detrás del objetivo. Tocar Reencuadrar mientras el zoom se
   * estaba acomodando aterrizaba en un FOV que no era 75, y tocarlo dos veces
   * rápido se pasaba de largo hasta topar en `maxFov`.
   *
   * Es el mismo trato que `goto` para el yaw y el pitch, y por la misma razón.
   */
  gotoFov: number | null

  /**
   * Destino animado. Si no es null, el rig interpola hacia ahí y lo limpia al llegar.
   * Cualquier input manual del usuario lo cancela.
   */
  goto: { yaw: number; pitch: number } | null

  /**
   * "Atravesar la puerta": la dirección (yaw, pitch) del punto de enlace que se
   * acaba de tocar. Un solo uso: el rig lo toma, empuja la cámara unas unidades
   * hacia allá mientras dura el fundido y la regresa al centro. Lo escribe solo
   * el visor al tocar un punto de ENLACE; la barra de habitaciones no lo toca,
   * porque ahí no hay puerta que cruzar. Ver `CameraRig`.
   */
  empuje: { yaw: number; pitch: number } | null

  /**
   * "Este recorrido gira solo": el modo kiosco. Estado CONTINUO, no de un solo
   * uso: mientras sea true, el rig gira la cámara despacio y sigue pidiendo
   * cuadro. Lo escribe `TourViewer` desde `tour.autogiro`; el editor de puntos
   * no lo toca nunca, porque para colocar un punto hace falta un encuadre
   * quieto. Apagado por defecto: encendido pelea de frente con los cero dibujos
   * por segundo del visor parado, y esa propiedad no se regala. Ver `CameraRig`.
   */
  autogiro: boolean

  /**
   * "Alguien tocó la foto": un solo uso. El rig lo lee, pausa el autogiro unos
   * segundos y lo pone en false. Existe porque un toque sin arrastre no deja
   * ningún otro rastro en este objeto —no mueve `dragYaw` ni `axis`— y quien
   * toca una foto que gira sola espera que se detenga.
   */
  pausa: boolean

  /**
   * Orientación ABSOLUTA del sensor (giroscopio), en grados del proyecto. Si no
   * es null, MANDA sobre el objetivo: el joystick, el arrastre y el `goto`
   * ajustan un offset en vez del objetivo, así que al encenderlo la cámara no
   * salta y al mover el teléfono la vista sigue a la mano. El pitch lo manda
   * solo el sensor. Lo escribe `useGyroLook` —con zona muerta angular, para que
   * un teléfono quieto siga dando cero dibujos— y lo pone en null al apagarse.
   */
  orientacion: { yaw: number; pitch: number } | null
}

/** Lo que la cámara le cuenta a la UI. El CameraRig lo escribe cada frame. */
export type CameraReadout = {
  yaw: number
  pitch: number
  fov: number
  /** Cuánto se ha desplazado la cámara del centro por el empuje, en unidades de escena. 0 en reposo. */
  avance: number
}

export type TourEngine = {
  input: LookInput
  readout: CameraReadout
  /**
   * ==========================================================================
   *  EL TIMBRE: "algo cambió, hay que repintar"
   * ==========================================================================
   *
   * Ni el visor 3D ni el HUD trabajan sesenta veces por segundo pase lo que
   * pase. Cuando la cámara está quieta no hay nada nuevo que pintar, y seguir
   * dibujando una esfera de 4096 px —y recalculando la posición de cada
   * marcador— solo calienta el teléfono y se come la pila. Medido: parado, el
   * visor pasó de 11 dibujos por segundo a CERO.
   *
   * El trato es que quien le escriba algo a `input` tiene que tocar el timbre,
   * o la imagen se queda congelada. Por eso vive aquí, junto al input: quien
   * escribe, avisa, en la línea de al lado.
   *
   * Una llamada despierta las dos capas y las mantiene despiertas un cuarto de
   * segundo. Como el `CameraRig` vuelve a tocar el timbre en cada cuadro
   * mientras la cámara se está acomodando, la animación se sostiene sola hasta
   * que se detiene de verdad.
   */
  invalidar: () => void

  /** La conecta CameraRig: es la que redibuja el canvas 3D. */
  conectarRender: (fn: (() => void) | null) => void

  /**
   * Suscribe algo del HUD (la brújula, los marcadores, el badge) al mismo
   * pulso. Devuelve la función para darse de baja.
   *
   * Antes cada pieza tenía su propio requestAnimationFrame, y los tres seguían
   * corriendo aunque la cámara llevara un minuto sin moverse.
   *
   * OJO, la regla que hay que recordar: el pulso se duerme solo. Cualquier cosa
   * que cambie lo que el HUD dibuja —un punto nuevo, un cambio de tamaño de la
   * ventana— tiene que llamar a `invalidar()`, o se quedará sin pintar hasta
   * que alguien mueva la cámara.
   */
  suscribirHud: (fn: () => void) => () => void

  /**
   * ==========================================================================
   *  UN SOLO DUEÑO DE LA CÁMARA
   * ==========================================================================
   *
   * Con el giroscopio encendido hay dos cosas queriendo girar la vista: el
   * teléfono y el dedo. La regla es que el dedo GANA —arrastrar es una
   * decisión deliberada, el teléfono se mueve solo por estar en una mano— y
   * apaga el sensor; el botón del HUD lo vuelve a encender.
   *
   * Lo llama el CameraRig, que es quien ya sabe distinguir "el usuario está
   * conduciendo" para las tres formas de conducir (joystick, teclado y
   * arrastre). Si la regla viviera en `useDragLook` habría que repetirla tres
   * veces y una se quedaría atrás.
   */
  soltarGiroscopio: () => void

  /** La conecta useGyroLook para enterarse de que le quitaron la cámara. */
  conectarGiroscopio: (fn: (() => void) | null) => void
}

/** Cuánto se quedan despiertas las dos capas tras un aviso. */
const DESPIERTO_MS = 250

export const createTourEngine = (): TourEngine => {
  let render: (() => void) | null = null
  let soltarGiro: (() => void) | null = null
  const hud = new Set<() => void>()
  let frame = 0
  let despiertoHasta = 0

  const tick = () => {
    for (const fn of hud) fn()
    if (performance.now() < despiertoHasta) {
      frame = requestAnimationFrame(tick)
    } else {
      frame = 0
    }
  }

  const invalidar = () => {
    render?.()
    despiertoHasta = performance.now() + DESPIERTO_MS
    if (frame === 0 && hud.size > 0) frame = requestAnimationFrame(tick)
  }

  return {
    input: {
      axis: { x: 0, y: 0 },
      dragYaw: 0,
      dragPitch: 0,
      dFov: 0,
      gotoFov: null,
      goto: null,
      empuje: null,
      autogiro: false,
      pausa: false,
      orientacion: null,
    },
    readout: { yaw: 0, pitch: 0, fov: 75, avance: 0 },
    invalidar,
    conectarRender: (fn) => {
      render = fn
    },
    soltarGiroscopio: () => {
      soltarGiro?.()
    },
    conectarGiroscopio: (fn) => {
      soltarGiro = fn
    },
    suscribirHud: (fn) => {
      hud.add(fn)
      // Una pasada de inmediato: al montarse hay que colocarse aunque nadie se
      // haya movido todavía.
      fn()
      invalidar()
      return () => {
        hud.delete(fn)
      }
    },
  }
}

const TourEngineContext = createContext<TourEngine | null>(null)

export const TourEngineProvider = TourEngineContext.Provider

/** Devuelve el objeto compartido. Es estable: nunca cambia de identidad. */
export function useTourEngine(): TourEngine {
  const engine = useContext(TourEngineContext)
  if (!engine) {
    throw new Error('useTourEngine debe usarse dentro de <TourViewer />')
  }
  return engine
}

/** Crea el engine una sola vez por montaje del visor. */
export function useCreateTourEngine(): TourEngine {
  const ref = useRef<TourEngine | null>(null)
  if (ref.current === null) ref.current = createTourEngine()
  return ref.current
}

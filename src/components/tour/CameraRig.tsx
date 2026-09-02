/* oxlint-disable react/immutability -- Mutar engine.input/engine.readout dentro de
   useFrame es justamente el diseño: cero renders de React por frame. */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { useTourEngine } from '../../lib/tourEngine'
import { DEG, clamp, damp, shortestDelta, wrap360 } from '../../lib/math'
import { yawPitchToVector3 } from '../../lib/math3d'
import { useMenosMovimiento } from '../../lib/menosMovimiento'

/**
 * ============================================================================
 *  EL EMPUJE: ATRAVESAR LA PUERTA
 * ============================================================================
 *
 * Al tocar un punto de enlace, la cámara se desplaza unas unidades HACIA ese
 * punto mientras dura el fundido a la habitación nueva, y regresa al centro.
 * Dentro de una esfera de radio 500, 40 unidades hacia la puerta hacen que lo
 * que hay al frente crezca ~8 %: se lee como dar dos pasos y cruzar, en vez de
 * un corte entre dos fotos. Es el cambio que más sube la calidad percibida del
 * visor, y son treinta líneas.
 *
 * La curva es una campana `sin²`: arranca y termina con velocidad cero, así que
 * no hay tirón ni al salir ni al llegar, y a los 0.6 s la cámara está EXACTAMENTE
 * en el origen otra vez — no "casi", porque los marcadores del HUD se proyectan
 * asumiendo la cámara en el centro (ver HotspotLayer) y un residuo los dejaría
 * despegados un píxel para siempre.
 *
 * Con `prefers-reduced-motion` no hay empuje: un desplazamiento de cámara es
 * exactamente el tipo de movimiento que molesta a quien activó ese ajuste. El
 * fundido corto de PanoSphere se encarga solo del cambio.
 *
 * Y la regla de oro del proyecto se conserva: mientras el empuje dura, este rig
 * pide cuadro; cuando termina, deja de pedirlo, y el visor vuelve a cero dibujos
 * por segundo. `rendimiento.mjs` lo mide.
 */
const EMPUJE = 40
const DURACION_EMPUJE = 0.6

export type CameraRigProps = {
  /** Grados por segundo con el joystick a tope. 90 ≈ un cuarto de vuelta por segundo. */
  maxSpeedDeg?: number
  /** Tope de inclinación. 85 evita el polo, donde la equirectangular se retuerce. */
  maxPitchDeg?: number
  /** Suavizado (lambda). Más alto = más seco/inmediato. Más bajo = más inercia. */
  smoothing?: number
  /** Campo de visión inicial y sus límites, en grados. */
  fov?: number
  minFov?: number
  maxFov?: number
  /** Yaw al montar la escena. */
  initialYaw?: number
  initialPitch?: number
  /** Invertir el eje vertical del joystick (estilo "piloto de avión"). */
  invertY?: boolean
}

/**
 * ============================================================================
 *  EL CORAZÓN DEL VISOR
 * ============================================================================
 *
 * Único dueño de la orientación de la cámara. Nadie más toca camera.rotation.
 *
 * Cada frame:
 *   1. lee el objeto mutable LookInput (joystick + arrastre + zoom),
 *   2. lo integra sobre un yaw/pitch OBJETIVO,
 *   3. suaviza la cámara real hacia ese objetivo (inercia),
 *   4. escribe la orientación y publica el estado para el HUD.
 *
 * ── La matemática, en corto ────────────────────────────────────────────────
 *
 * Con la cámara en el origen mirando por defecto hacia -Z y el orden de Euler
 * YXZ (primero el yaw en el eje Y del mundo, luego el pitch en el eje X ya
 * girado — exactamente como una cámara en primera persona):
 *
 *   camera.rotation.y = -yaw · π/180
 *   camera.rotation.x = +pitch · π/180
 *
 * El signo negativo del yaw es la parte que casi siempre sale al revés:
 * en three.js, girar +θ sobre Y lleva la mirada de -Z hacia -X, y -X está a la
 * IZQUIERDA de la cámara. O sea, +rotation.y = mirar a la izquierda. Como
 * queremos que "joystick a la derecha → cámara a la derecha", invertimos.
 *
 * ── Por qué el yaw nunca se normaliza ──────────────────────────────────────
 *
 * El yaw interno crece sin límite (puede valer 3000°). Si lo envolviéramos a
 * (-180, 180] el suavizado daría un latigazo de vuelta completa cada vez que
 * cruzas la costura. Solo se normaliza para MOSTRARLO en la brújula.
 *
 * ── Por qué la velocidad escala con el FOV ─────────────────────────────────
 *
 * Con zoom cerrado (FOV chico) el mismo giro en grados recorre muchos más
 * píxeles en pantalla. Escalando la velocidad por fov/75, el joystick se siente
 * igual de preciso con y sin zoom.
 */
export function CameraRig({
  maxSpeedDeg = 90,
  maxPitchDeg = 85,
  smoothing = 12,
  fov = 75,
  minFov = 30,
  maxFov = 100,
  initialYaw = 0,
  initialPitch = 0,
  invertY = false,
}: CameraRigProps) {
  const engine = useTourEngine()
  const invalidate = useThree((s) => s.invalidate)
  const menosMovimiento = useMenosMovimiento()

  /* El canvas dibuja "a pedido" (ver Escena360). Aquí se conecta el timbre:
     desde este momento, cualquiera que le escriba al input puede pedir cuadro. */
  useEffect(() => {
    engine.conectarRender(invalidate)
    engine.invalidar()
    return () => engine.conectarRender(null)
  }, [engine, invalidate])

  // Objetivo (a donde el input quiere ir) y valor real (lo que se dibuja).
  const targetYaw = useRef(initialYaw)
  const targetPitch = useRef(initialPitch)
  const yaw = useRef(initialYaw)
  const pitch = useRef(initialPitch)

  const targetFov = useRef(fov)
  const currentFov = useRef(fov)

  /* El empuje: hacia dónde y cuánto tiempo lleva. `Infinity` es "en reposo". */
  const direccionEmpuje = useRef(new Vector3())
  const tiempoEmpuje = useRef(Infinity)

  useFrame((state, delta) => {
    const camera = state.camera as PerspectiveCamera
    const { input, readout } = engine

    // Si la pestaña estuvo en segundo plano, delta puede venir en segundos
    // enteros y la cámara pegaría un salto al volver. Lo topamos.
    //
    // El tope es 1/10 s y no 1/60: topar cerca del framerate normal haría que
    // en un equipo lento el joystick girara MÁS DESPACIO que en uno rápido,
    // porque se descartaría parte del tiempo transcurrido. Con 100 ms aguanta
    // hasta 10 fps sin penalizar, y sigue evitando el salto de la pestaña.
    const dt = Math.min(delta, 1 / 10)

    /* ---------------------------------------------------------------- ZOOM */
    if (input.dFov !== 0) {
      targetFov.current = clamp(targetFov.current + input.dFov, minFov, maxFov)
      input.dFov = 0
    }
    /* El destino absoluto va DESPUÉS del delta, y a propósito: si en el mismo
       cuadro llegan un pellizco y un "Reencuadrar", manda el reencuadre. Es un
       botón explícito contra un gesto continuo. */
    if (input.gotoFov !== null) {
      targetFov.current = clamp(input.gotoFov, minFov, maxFov)
      input.gotoFov = null
    }
    currentFov.current = damp(currentFov.current, targetFov.current, 10, dt)
    if (Math.abs(camera.fov - currentFov.current) > 1e-3) {
      camera.fov = currentFov.current
      camera.updateProjectionMatrix()
    }

    /* ------------------------------------------------- CANCELAR ANIMACIÓN */
    const userIsDriving =
      input.axis.x !== 0 || input.axis.y !== 0 || input.dragYaw !== 0 || input.dragPitch !== 0
    if (userIsDriving) input.goto = null

    /* ------------------------------------------ JOYSTICK → VELOCIDAD ANGULAR
     * El joystick NO da una posición absoluta: da una velocidad. Mantenerlo
     * empujado a la derecha gira de forma continua, como en un juego.
     * Multiplicar por dt (y no por frame) hace que gire igual a 60 y a 120 Hz. */
    const speed = maxSpeedDeg * (currentFov.current / 75)
    targetYaw.current += input.axis.x * speed * dt
    targetPitch.current += (invertY ? -input.axis.y : input.axis.y) * speed * dt

    /* -------------------------------------------- ARRASTRE → DELTAS DIRECTOS
     * El dedo sobre la foto ya viene convertido a grados (ver useDragLook),
     * así que se suma tal cual y se consume. */
    targetYaw.current += input.dragYaw
    targetPitch.current += input.dragPitch
    input.dragYaw = 0
    input.dragPitch = 0

    /* -------------------------------------------------- DESTINO PROGRAMADO
     * Un solo disparo: movemos el OBJETIVO por el camino corto y dejamos que
     * el suavizado de abajo haga la animación. */
    if (input.goto) {
      targetYaw.current += shortestDelta(targetYaw.current, input.goto.yaw)
      targetPitch.current = input.goto.pitch
      input.goto = null
    }

    targetPitch.current = clamp(targetPitch.current, -maxPitchDeg, maxPitchDeg)

    /* ------------------------------------------------------------ SUAVIZADO */
    yaw.current = damp(yaw.current, targetYaw.current, smoothing, dt)
    pitch.current = damp(pitch.current, targetPitch.current, smoothing, dt)

    /* --------------------------------------------------------------- EMPUJE
     * Un solo disparo: se toma la dirección de la puerta y arranca el reloj. Se
     * consume aunque el aparato pida menos movimiento, para que no se quede
     * pendiente y salte después. */
    if (input.empuje) {
      if (!menosMovimiento.current) {
        yawPitchToVector3(input.empuje.yaw, input.empuje.pitch, 1, direccionEmpuje.current)
        tiempoEmpuje.current = 0
      }
      input.empuje = null
    }
    let avance = 0
    if (tiempoEmpuje.current < DURACION_EMPUJE) {
      tiempoEmpuje.current += dt
      const f = tiempoEmpuje.current / DURACION_EMPUJE
      // Campana sin²(πf): 0 → EMPUJE → 0, con velocidad cero en los dos extremos.
      if (f < 1) avance = EMPUJE * 0.5 * (1 - Math.cos(2 * Math.PI * f))
    }

    /* ------------------------------------------------- APLICAR A LA CÁMARA */
    if (avance > 0) {
      camera.position.copy(direccionEmpuje.current).multiplyScalar(avance)
    } else {
      camera.position.set(0, 0, 0)
    }
    camera.rotation.order = 'YXZ'
    camera.rotation.set(pitch.current * DEG, -yaw.current * DEG, 0)

    /* --------------------------------------------------- PUBLICAR PARA EL HUD */
    readout.yaw = wrap360(yaw.current)
    readout.pitch = pitch.current
    readout.fov = currentFov.current
    readout.avance = avance

    /* ------------------------------------------------- ¿HACE FALTA OTRO CUADRO?
     * Mientras el dedo empuje o la cámara siga acomodándose hacia su objetivo,
     * sí. Cuando todo se detiene, se deja de pedir y el teléfono descansa: el
     * siguiente cuadro lo pedirá quien vuelva a tocar algo.
     *
     * Los umbrales son una décima de grado y de FOV: por debajo de eso el
     * movimiento ya no se ve, y perseguirlo hasta el cero exacto dejaría la
     * animación viva para siempre, que es justo lo que se quiere evitar. */
    const enMovimiento =
      input.axis.x !== 0 ||
      input.axis.y !== 0 ||
      Math.abs(targetYaw.current - yaw.current) > 0.05 ||
      Math.abs(targetPitch.current - pitch.current) > 0.05 ||
      Math.abs(targetFov.current - currentFov.current) > 0.05 ||
      // El empuje es una animación: mientras dure hay que seguir pidiendo.
      tiempoEmpuje.current < DURACION_EMPUJE
    if (enMovimiento) engine.invalidar()
  })

  return null
}

/* oxlint-disable react/immutability -- Mutar engine.input/engine.readout dentro de
   useFrame es justamente el diseño: cero renders de React por frame. */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { PerspectiveCamera } from 'three'
import { useTourEngine } from '../../lib/tourEngine'
import { DEG, clamp, damp, shortestDelta, wrap360 } from '../../lib/math'
import { anclarSesionGiro, desfaseHacia } from '../../lib/useGyroLook'
import { menosMovimiento } from '../../lib/movimiento'

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
 *   1. lee el objeto mutable LookInput (joystick + arrastre + zoom + sensor),
 *   2. lo integra sobre un yaw/pitch OBJETIVO,
 *   3. suaviza la cámara real hacia ese objetivo (inercia),
 *   4. escribe la orientación y publica el estado para el HUD.
 *
 * El giroscopio es la excepción a los pasos 2 y 3: no aporta velocidad ni
 * deltas sino una posición, y se planta en ella sin inercia. Ver el bloque
 * GIROSCOPIO más abajo y src/lib/useGyroLook.ts.
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

  /* Giroscopio. `desfaseGiro` son los grados que hay que sumarle a la lectura
     del sensor para que caiga sobre la habitación (el cero del giroscopio es
     arbitrario), y `sesionGiro` es la identidad del objeto que publica
     useGyroLook: cuando cambia es que el sensor se acaba de encender y el
     desfase de la sesión anterior ya no sirve. Ver src/lib/useGyroLook.ts. */
  const desfaseGiro = useRef(0)
  const sesionGiro = useRef<object | null>(null)

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
    currentFov.current = damp(currentFov.current, targetFov.current, 10, dt)
    if (Math.abs(camera.fov - currentFov.current) > 1e-3) {
      camera.fov = currentFov.current
      camera.updateProjectionMatrix()
    }

    /* ------------------------------------------------- CANCELAR ANIMACIÓN
     * Y, de paso, resolver quién manda: si la persona está conduciendo —dedo,
     * joystick o teclado— el giroscopio se apaga aquí mismo. Es el único sitio
     * donde vive esa regla, para que no pueda quedarse a medias en uno de los
     * tres caminos; el porqué está en `soltarGiroscopio` (src/lib/tourEngine.ts).
     *
     * El pellizco de zoom no entra en la cuenta a propósito: mueve `dFov` y no
     * la dirección, así que acercarse mientras se mira con el teléfono es un
     * gesto perfectamente compatible y no tiene por qué apagar nada. */
    const userIsDriving =
      input.axis.x !== 0 || input.axis.y !== 0 || input.dragYaw !== 0 || input.dragPitch !== 0
    if (userIsDriving) {
      input.goto = null
      if (input.absoluto !== null) {
        input.absoluto = null
        engine.soltarGiroscopio()
      }
    }

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

    /* ------------------------------------------------ ¿MANDA EL GIROSCOPIO?
     * Un objeto distinto al de la vuelta pasada significa sesión nueva: el
     * sensor se acaba de encender y hay que anotar cuántos grados separan su
     * cero arbitrario de la dirección que la cámara ya tenía, o la vista daría
     * un latigazo de hasta media vuelta al tocar el botón.
     *
     * El ancla es `yaw.current` —lo que se está dibujando— y no el objetivo;
     * el porqué, con la secuencia que lo rompe, está en `anclarSesionGiro`.
     * Aquí se le pasan los dos para que la elección viva allá, en una función
     * con prueba, y no en cuál de estos dos refs quedó escrito en esta línea. */
    const absoluto = input.absoluto
    if (absoluto === null) {
      sesionGiro.current = null
    } else if (sesionGiro.current !== absoluto) {
      sesionGiro.current = absoluto
      desfaseGiro.current = anclarSesionGiro(
        { yaw: yaw.current, targetYaw: targetYaw.current },
        absoluto.yaw,
      )
    }

    /* -------------------------------------------------- DESTINO PROGRAMADO
     * Un solo disparo: movemos el OBJETIVO por el camino corto y dejamos que
     * el suavizado de abajo haga la animación.
     *
     * Con el giroscopio al mando el destino no puede mover la cámara: su
     * orientación la dicta un teléfono que está donde está, y un cuadro después
     * la lectura del sensor volvería a pisar el destino. Lo que se mueve es la
     * habitación debajo, o sea el desfase. La persona entra al cuarto nuevo
     * mirando a su frente sin haber girado el cuerpo, que es justo lo que
     * espera de un enlace. El pitch del destino se ignora: la inclinación la
     * decide el teléfono. */
    if (input.goto) {
      if (absoluto !== null) {
        desfaseGiro.current = desfaseHacia(absoluto.yaw, desfaseGiro.current, input.goto.yaw)
      } else {
        targetYaw.current += shortestDelta(targetYaw.current, input.goto.yaw)
        targetPitch.current = input.goto.pitch
      }
      input.goto = null
    }

    /* --------------------------------------------- GIROSCOPIO → POSICIÓN
     * No es una velocidad como el joystick ni un delta como el arrastre: es la
     * dirección en la que está apuntando el teléfono, y la cámara se planta
     * ahí. Por el camino corto, porque el yaw interno crece sin límite y el
     * del sensor vive en (-180, 180]: sin esto, cruzar el sur daría una vuelta
     * completa de latigazo.
     *
     * El pitch NO lleva desfase, y es a propósito: el yaw del giroscopio
     * arranca en un cero arbitrario, pero el pitch lo da la gravedad y
     * significa algo de verdad —cero es el horizonte—. Corregirlo rompería lo
     * único que hace que esto se sienta como una ventana: que enderezar el
     * teléfono te deje mirando al frente. El precio es que al encender, la
     * vista salta a la inclinación en la que ya venía el teléfono en la mano.
     * Es el mismo precio que pagan Photo Sphere Viewer, Pannellum y view360. */
    if (absoluto !== null) {
      targetYaw.current += shortestDelta(targetYaw.current, absoluto.yaw + desfaseGiro.current)
      targetPitch.current = absoluto.pitch
    }

    /* El tope de inclinación se aplica igual al sensor: con el teléfono
       apuntando al piso la lectura llega a −90, y ahí la equirectangular se
       retuerce en el polo. La vista se queda en el tope mientras el teléfono
       sigue bajando, que es el comportamiento normal de un visor 360. */
    targetPitch.current = clamp(targetPitch.current, -maxPitchDeg, maxPitchDeg)

    /* ------------------------------------------------------------ SUAVIZADO
     * Con "reducir movimiento" encendido no hay inercia: la cámara se planta en
     * su objetivo de un solo cuadro. La que sufre de verdad es la animación de
     * los puntos —tocar un hotspot dispara un paneo de casi un segundo con la
     * panorámica entera barriendo la pantalla, que es justo el movimiento que
     * marea—; el arrastre con el dedo apenas cambia, porque ahí el objetivo va
     * pegado al dedo de todos modos.
     *
     * Va DESPUÉS del clamp a propósito: copiar el objetivo antes de toparlo
     * dejaría el pitch pasarse de los 85° y la panorámica se retorcería en el
     * polo, que es exactamente lo que el clamp está evitando.
     *
     * Con el giroscopio tampoco hay inercia, y por un motivo distinto: la
     * lectura ya viene filtrada por el OrientationTracker, con un lambda que
     * se adapta a la velocidad del giro (6 quieto, hasta 25 girando). Suavizar
     * dos veces una señal que ya viene suave no se siente como suavidad, se
     * siente como que el teléfono va tarde. */
    if (absoluto !== null || menosMovimiento()) {
      yaw.current = targetYaw.current
      pitch.current = targetPitch.current
    } else {
      yaw.current = damp(yaw.current, targetYaw.current, smoothing, dt)
      pitch.current = damp(pitch.current, targetPitch.current, smoothing, dt)
    }

    /* ------------------------------------------------- APLICAR A LA CÁMARA */
    camera.position.set(0, 0, 0)
    camera.rotation.order = 'YXZ'
    camera.rotation.set(pitch.current * DEG, -yaw.current * DEG, 0)

    /* --------------------------------------------------- PUBLICAR PARA EL HUD */
    readout.yaw = wrap360(yaw.current)
    readout.pitch = pitch.current
    readout.fov = currentFov.current

    /* ------------------------------------------------- ¿HACE FALTA OTRO CUADRO?
     * Mientras el dedo empuje o la cámara siga acomodándose hacia su objetivo,
     * sí. Cuando todo se detiene, se deja de pedir y el teléfono descansa: el
     * siguiente cuadro lo pedirá quien vuelva a tocar algo.
     *
     * Los umbrales son una décima de grado y de FOV: por debajo de eso el
     * movimiento ya no se ve, y perseguirlo hasta el cero exacto dejaría la
     * animación viva para siempre, que es justo lo que se quiere evitar.
     *
     * Con el giroscopio la cuenta da falso casi siempre —la cámara se planta
     * en su objetivo sin inercia— y está bien: ahí el que pide cuadro es el
     * bucle de useGyroLook, y solo cuando llega una lectura NUEVA. Con el
     * teléfono apoyado en la mesa el visor se duerme igual que sin sensor. */
    const enMovimiento =
      input.axis.x !== 0 ||
      input.axis.y !== 0 ||
      Math.abs(targetYaw.current - yaw.current) > 0.05 ||
      Math.abs(targetPitch.current - pitch.current) > 0.05 ||
      Math.abs(targetFov.current - currentFov.current) > 0.05
    if (enMovimiento) engine.invalidar()
  })

  return null
}

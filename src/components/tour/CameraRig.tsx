/* oxlint-disable react/immutability -- Mutar engine.input/engine.readout dentro de
   useFrame es justamente el diseño: cero renders de React por frame. */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { useTourEngine } from '../../lib/tourEngine'
import { DEG, clamp, damp, shortestDelta, wrap360 } from '../../lib/math'
import { yawPitchToVector3 } from '../../lib/math3d'
import { useMenosMovimiento } from '../../lib/menosMovimiento'
import { desenvolver, offsetHacia, offsetSinSalto } from '../../lib/giro'

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

/**
 * ============================================================================
 *  EL AUTOGIRO: EL MODO KIOSCO
 * ============================================================================
 *
 * Con `input.autogiro` la cámara gira sola, despacio, como en una pantalla de
 * oficina o de feria. Pelea de frente con el diseño del visor —girar es dibujar
 * sin parar— y por eso está apagado por defecto, es una opción por recorrido, y
 * se rinde ante tres cosas, en este orden de importancia:
 *
 *   · `prefers-reduced-motion`: nunca gira. Una foto a pantalla completa que se
 *     mueve sola es exactamente lo que molesta a quien pidió menos movimiento.
 *   · La pestaña oculta: no gira ni pide cuadro. Un kiosco en segundo plano
 *     calentando el teléfono no le sirve a nadie.
 *   · Cualquier interacción —un toque, el arrastre, el joystick, el zoom, un
 *     cambio de habitación— lo pausa PAUSA_AUTOGIRO segundos. "Se detiene al
 *     tocar, sigue solo a los cinco segundos" es lo que hacen los visores
 *     comerciales, y es lo que espera quien toca una foto que gira.
 *
 * Mientras dura la pausa NO se pide ningún cuadro: el visor vuelve a cero
 * dibujos por segundo como si el autogiro no existiera. Eso deja una pregunta
 * que el resto del rig no tiene: ¿quién vuelve a llamar a `useFrame` cuando la
 * pausa termine? Un solo `setTimeout` que toca el timbre en ese momento, y que
 * solo se re-arma si el plazo cambió. `rendimiento.mjs` mide las tres cosas.
 *
 * Los dos números son provisionales, y así está escrito en el plan: 6°/s es
 * una vuelta por minuto —lo bastante lento para leerse como "la casa se
 * muestra" y no como un video—, y 5 s de pausa es lo que tarda alguien en
 * decidir si quería mirar algo. Se ajustan con la investigación de la Pestaña 1
 * (pregunta 15), no antes.
 */
const VELOCIDAD_AUTOGIRO = 6
const PAUSA_AUTOGIRO = 5

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

  /* El giroscopio: el yaw del sensor DESENVUELTO (crece sin límite, como el
     objetivo, para que 179° → -179° no sea una vuelta entera) y el offset que
     el gesto ajusta encima. `conSensor` recuerda si el cuadro anterior ya venía
     con sensor, para fijar el offset sin salto la primera vez. */
  const conSensor = useRef(false)
  const sensorYaw = useRef(0)
  const offsetYaw = useRef(0)

  /* El autogiro: hasta cuándo dura la pausa, y el despertador que la termina. */
  const pausaHasta = useRef(0)
  const despertador = useRef<{ id: number; para: number } | null>(null)
  const despertarEn = (cuando: number) => {
    if (despertador.current?.para === cuando) return
    if (despertador.current) window.clearTimeout(despertador.current.id)
    const id = window.setTimeout(() => {
      despertador.current = null
      engine.invalidar()
    }, Math.max(0, cuando - performance.now()))
    despertador.current = { id, para: cuando }
  }
  useEffect(
    () => () => {
      if (despertador.current) window.clearTimeout(despertador.current.id)
    },
    [],
  )
  /* La pestaña que vuelve a verse: mientras estuvo oculta no se pidió cuadro, así
     que hay que tocar el timbre para que el autogiro retome. */
  useEffect(() => {
    const alCambiar = () => {
      if (document.visibilityState === 'visible') engine.invalidar()
    }
    document.addEventListener('visibilitychange', alCambiar)
    return () => document.removeEventListener('visibilitychange', alCambiar)
  }, [engine])

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

    /* ------------------------------------------------------------ AUTOGIRO
     * Va ANTES de consumir nada: aquí todavía se ve todo lo que la persona hizo
     * en este cuadro, y cualquier cosa que haya hecho pausa el giro. */
    const ahora = performance.now()
    const interaccion =
      input.pausa ||
      input.axis.x !== 0 ||
      input.axis.y !== 0 ||
      input.dragYaw !== 0 ||
      input.dragPitch !== 0 ||
      input.dFov !== 0 ||
      input.gotoFov !== null ||
      input.goto !== null ||
      input.empuje !== null
    input.pausa = false
    if (interaccion) pausaHasta.current = ahora + PAUSA_AUTOGIRO * 1000
    const girando =
      input.autogiro &&
      // Con el teléfono en la mano no hay kiosco: el sensor manda.
      input.orientacion === null &&
      !menosMovimiento.current &&
      document.visibilityState === 'visible' &&
      ahora >= pausaHasta.current
    if (girando) targetYaw.current += VELOCIDAD_AUTOGIRO * dt

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
    /* Con el sensor encendido, joystick, arrastre y destino NO tocan el objetivo:
       van al offset, en el bloque GIROSCOPIO de abajo. */
    const sensor = input.orientacion
    if (!sensor) {
      targetYaw.current += input.axis.x * speed * dt
      targetPitch.current += (invertY ? -input.axis.y : input.axis.y) * speed * dt
    }

    /* -------------------------------------------- ARRASTRE → DELTAS DIRECTOS
     * El dedo sobre la foto ya viene convertido a grados (ver useDragLook),
     * así que se suma tal cual y se consume. */
    if (!sensor) {
      targetYaw.current += input.dragYaw
      targetPitch.current += input.dragPitch
      input.dragYaw = 0
      input.dragPitch = 0
    }

    /* -------------------------------------------------- DESTINO PROGRAMADO
     * Un solo disparo: movemos el OBJETIVO por el camino corto y dejamos que
     * el suavizado de abajo haga la animación. */
    if (!sensor && input.goto) {
      targetYaw.current += shortestDelta(targetYaw.current, input.goto.yaw)
      targetPitch.current = input.goto.pitch
      input.goto = null
    }

    /* ----------------------------------------------------------- GIROSCOPIO
     * El sensor es ABSOLUTO y el gesto ajusta un OFFSET, no el objetivo:
     *
     *   objetivo = yaw del sensor (desenvuelto) + offset
     *
     * · Al encenderse, el offset se elige para que el objetivo NO cambie: la
     *   cámara se queda donde estaba y desde ahí sigue a la mano. Sin esto,
     *   encender el giroscopio pegaba un latigazo hacia donde apuntara el
     *   teléfono en ese instante.
     * · Joystick y arrastre suman al offset; el `goto` de un cambio de
     *   habitación también (por el camino corto). Así "mirar con el teléfono" y
     *   "corregir con el dedo" no se pelean: el dedo desplaza el marco y el
     *   teléfono sigue mandando dentro de él.
     * · El pitch lo manda SOLO el sensor y el arrastre vertical se ignora. Es lo
     *   que hace Street View, y evita de raíz un fallo feo: si el arrastre
     *   acumulara un offset de pitch y la persona empujara contra el tope de
     *   85°, el offset seguiría creciendo y bajar la vista no haría nada hasta
     *   desenrollarlo.
     * · El yaw del sensor llega envuelto a (-180, 180]; se acumula por el camino
     *   corto para que cruzar la costura no sea una vuelta entera de suavizado. */
    if (sensor) {
      if (!conSensor.current) {
        sensorYaw.current = sensor.yaw
        offsetYaw.current = offsetSinSalto(targetYaw.current, sensor.yaw)
        conSensor.current = true
      } else {
        sensorYaw.current = desenvolver(sensorYaw.current, sensor.yaw)
      }
      offsetYaw.current += input.axis.x * speed * dt + input.dragYaw
      if (input.goto) {
        offsetYaw.current = offsetHacia(sensorYaw.current, offsetYaw.current, input.goto.yaw)
        input.goto = null
      }
      input.dragYaw = 0
      input.dragPitch = 0
      targetYaw.current = sensorYaw.current + offsetYaw.current
      targetPitch.current = sensor.pitch
    } else {
      conSensor.current = false
    }

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
     * Con el giroscopio SÍ se conserva la inercia, a diferencia de lo que hacía
     * la otra implementación de esta misma pantalla: la lectura ya viene
     * suavizada por el seguidor, pero el offset que el dedo y el joystick le
     * suman no, y `giroscopio.mjs` mide la respuesta con las tolerancias de
     * siempre (±3°). Si algún día se siente tarde, se quita aquí y se vuelve a
     * medir; no antes. */
    if (menosMovimiento.current) {
      yaw.current = targetYaw.current
      pitch.current = targetPitch.current
    } else {
      yaw.current = damp(yaw.current, targetYaw.current, smoothing, dt)
      pitch.current = damp(pitch.current, targetPitch.current, smoothing, dt)
    }

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
      Math.abs(targetFov.current - currentFov.current) > 0.05 ||
      // El empuje es una animación: mientras dure hay que seguir pidiendo.
      tiempoEmpuje.current < DURACION_EMPUJE ||
      // Y el autogiro es la única que no termina sola.
      girando
    if (enMovimiento) engine.invalidar()
    else if (input.autogiro && !menosMovimiento.current && ahora < pausaHasta.current) {
      // En pausa: nadie pide cuadro. El despertador toca el timbre al terminar.
      despertarEn(pausaHasta.current)
    }
  })

  return null
}

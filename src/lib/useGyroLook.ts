/* oxlint-disable react/immutability -- Escribirle a engine.input es justamente el
   diseño: es el canal sin renders entre los sensores y la cámara. Ver la nota de
   arquitectura en src/lib/tourEngine.ts */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Quaternion } from 'three'

import {
  OrientationTracker,
  anglesOf,
  needsOrientationPermission,
  requestOrientationPermission,
} from './capture/orientation'
import { shortestDelta } from './math'
import type { TourEngine } from './tourEngine'

/**
 * ============================================================================
 *  MIRAR MOVIENDO EL TELÉFONO
 * ============================================================================
 *
 * En un iPhone el gesto natural para mirar alrededor no es arrastrar con el
 * pulgar: es girar el cuerpo con el teléfono en la mano, como si fuera una
 * ventana. Hasta ahora el visor solo ofrecía joystick y arrastre.
 *
 * Lo caro ya estaba escrito y probado en src/lib/capture/orientation.ts, donde
 * lo usa la captura de panorámicas: el permiso de iOS, la conversión de
 * alpha/beta/gamma a un cuaternión con las dos correcciones que no son
 * evidentes, la rotación de pantalla, y la fusión del giroscopio relativo con
 * `webkitCompassHeading` para tener norte real. Este archivo no repite nada de
 * eso: solo lo conecta al visor.
 *
 * ── Por qué el sensor NO se vuelve a suavizar ──────────────────────────────
 *
 * El `OrientationTracker` ya entrega una versión filtrada (`reading.suave`) con
 * un lambda adaptativo que va de 6 con el teléfono quieto a 25 girando: quieto
 * mata el temblor de la mano, girando persigue de cerca. Volver a pasar eso por
 * el `damp` del CameraRig sumaría dos retrasos encima del otro, y una imagen
 * que llega tarde cuando mueves la cabeza no se lee como "suave", se lee como
 * "el teléfono va lento". Por eso el CameraRig se salta su suavizado mientras
 * el giroscopio manda (es lo mismo que hace el plugin de Photo Sphere Viewer
 * poniendo `moveInertia = 0`).
 *
 * ── Modo YAWPITCH: el ladeo se tira a la basura ────────────────────────────
 *
 * La lectura trae tres ángulos y aquí solo se usan dos. Si el ladeo (roll) se
 * aplicara, la habitación entera se inclinaría cada vez que la persona ladea la
 * muñeca —y nadie sostiene un teléfono perfectamente derecho—. Es la misma
 * decisión que egjs-view360 llama modo YAWPITCH frente al modo VR: para una
 * pantalla plana el horizonte tiene que quedarse horizontal.
 *
 * ── Quién manda cuando hay dos que quieren la cámara ───────────────────────
 *
 * El arrastre con el dedo GANA y apaga el giroscopio; el botón lo vuelve a
 * encender. El razonamiento: el dedo sobre la pantalla es una decisión
 * deliberada de la persona ("quiero ver ESO"), mientras que el teléfono se
 * mueve solo por el hecho de estar en una mano. Si el sensor pudiera pisar al
 * dedo, arrastrar se sentiría como pelear contra el aparato.
 *
 * Quien ejecuta la política es el CameraRig, en un solo sitio, porque ya sabe
 * distinguir "el usuario está conduciendo" (joystick, teclado o arrastre) y así
 * la regla no se puede quedar a medias en uno de los tres caminos. Cuando lo
 * detecta llama a `engine.soltarGiroscopio()`, que llega hasta el `apagar()` de
 * aquí. El pellizco de zoom NO cuenta como conducir: cambiar el encuadre es
 * compatible con seguir mirando con el teléfono.
 *
 * ── Lo que no se puede comprobar sin un iPhone ─────────────────────────────
 *
 * Ni el permiso de iOS, ni la latencia real, ni si el norte de la brújula cae
 * donde debe. Nada de eso existe en un escritorio ni en CI. Por eso todo lo que
 * es una suposición está detrás de una guarda que degrada a lo de hoy —el visor
 * con joystick y arrastre, intacto— y por eso lo único que sí es comprobable
 * (la aritmética del desfase) vive en funciones puras con pruebas.
 */

/** Lo que el botón del HUD necesita saber. */
export type GiroscopioUI = {
  /** ¿Tiene sentido enseñar el botón? Ver `puedeHaberSensores`. */
  disponible: boolean
  /** El sensor está mandando la cámara ahora mismo. */
  activo: boolean
  /** Texto en español para la persona, o null. Se borra solo. */
  mensaje: string | null
  /** Encender/apagar. TIENE que colgarse de un click: iOS exige un gesto. */
  alternar: () => void
}

/* ============================================================================
 *  LA ARITMÉTICA DEL DESFASE (lo único que sí se puede probar sin teléfono)
 * ========================================================================== */

/**
 * Dirección a la que apunta la espalda del teléfono, sin el ladeo.
 *
 * Es `anglesOf` con el roll tirado a la basura, y existe como función con
 * nombre para que quede escrito en un solo lugar que el visor mira en dos ejes
 * y no en tres.
 */
export function miradaDelSensor(orientacion: Quaternion): { yaw: number; pitch: number } {
  const angulos = anglesOf(orientacion)
  return { yaw: angulos.yaw, pitch: angulos.pitch }
}

/**
 * Cuántos grados hay que sumarle al yaw del sensor para que la vista NO se
 * mueva en el instante de encender.
 *
 * El cero del giroscopio es arbitrario (en iOS `alpha` arranca donde se le
 * antoja). Sin esto, tocar el botón daría un latigazo de hasta media vuelta
 * hacia una dirección que no significa nada. Con esto, la primera lectura cae
 * exactamente donde ya estaba mirando la cámara y a partir de ahí se mueve
 * junto con el teléfono. Es el `alphaOffset` del plugin de Photo Sphere Viewer.
 */
export const desfaseInicial = (yawCamara: number, yawSensor: number) => yawCamara - yawSensor

/**
 * Nuevo desfase para que el sensor pase a apuntar a `destino`.
 *
 * Sirve para los saltos programados (cambiar de habitación, reencuadrar)
 * mientras el sensor manda: la cámara no puede "viajar" a ningún lado, porque
 * su orientación la dicta un teléfono que está donde está. Lo que se mueve es
 * la habitación debajo, o sea el desfase, y el resultado es lo que la persona
 * espera: entrar al cuarto nuevo mirando a su frente, sin girar el cuerpo.
 *
 * Por el camino corto, igual que el `goto` normal: sin `shortestDelta` un
 * destino a −179° daría la vuelta larga por 181°.
 */
export const desfaseHacia = (yawSensor: number, desfase: number, destino: number) =>
  desfase + shortestDelta(yawSensor + desfase, destino)

/* ========================================================================== */

/**
 * ¿Vale la pena enseñar el botón?
 *
 * No hay forma honesta de saberlo antes de encender el sensor: en Chrome de
 * escritorio `DeviceOrientationEvent` existe y el evento simplemente nunca
 * dispara. Así que esto es una apuesta, y la apuesta es conservadora — un botón
 * que no hace nada es peor que no tener botón:
 *
 *   · iOS 13+ se delata solo, porque es el único que expone
 *     `DeviceOrientationEvent.requestPermission`.
 *   · Los demás, solo si el puntero es "grueso", que es la señal de que hay un
 *     dedo y no un ratón.
 *
 * La verdad llega dos segundos después: si el `OrientationTracker` no recibe ni
 * una lectura, se declara `no-soportado` y el botón desaparece.
 */
function puedeHaberSensores(): boolean {
  if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return false
  if (needsOrientationPermission()) return true
  return window.matchMedia?.('(pointer: coarse)').matches ?? false
}

/** Cuánto se queda en pantalla un aviso antes de retirarse solo. */
const AVISO_MS = 6000

export function useGyroLook(engine: TourEngine): GiroscopioUI {
  /* El seguidor se crea UNA sola vez y vive lo que viva el visor: si se
     recreara en cada render, el bucle estaría leyendo un objeto distinto del
     que está recibiendo los eventos del sensor. */
  const [seguidor] = useState(() => new OrientationTracker())

  const [disponible, setDisponible] = useState(puedeHaberSensores)
  const [activo, setActivo] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  /** El `activo` de React llega tarde a los manejadores; este no. */
  const activoRef = useRef(false)
  const cuadro = useRef(0)
  const avisoTimer = useRef(0)
  /** `updatedAt` de la última lectura que ya se publicó. */
  const ultima = useRef(-1)
  /**
   * El objeto que ve el CameraRig. Se crea uno NUEVO por cada encendido y
   * después solo se le mutan los campos: sesenta lecturas por segundo son
   * sesenta objetos por segundo que el recolector de basura tendría que
   * limpiar en medio de la animación. Y el cambio de identidad es además la
   * señal que usa el rig para saber que empieza una sesión nueva y tiene que
   * recalcular el desfase.
   */
  const destino = useRef<{ yaw: number; pitch: number } | null>(null)

  const avisar = useCallback((texto: string | null) => {
    window.clearTimeout(avisoTimer.current)
    setMensaje(texto)
    if (texto !== null) {
      avisoTimer.current = window.setTimeout(() => setMensaje(null), AVISO_MS)
    }
  }, [])

  /**
   * Arranca el sensor y el bucle de lectura.
   *
   * El bucle es un requestAnimationFrame y no el propio evento del sensor por
   * dos razones. Una, que así no hay que engancharse a `deviceorientation` por
   * segunda vez ni depender del orden en que corren los escuchas. Y dos, que
   * el trabajo se hace a la velocidad a la que el teléfono va a dibujar y no a
   * la que llegan los eventos, que en iOS pueden ser 60 por segundo aunque la
   * pantalla no los pueda mostrar.
   *
   * El bucle en sí no dibuja: si la lectura no cambió, no toca nada y no llama
   * a `invalidar()`. Eso importa porque el canvas está en `frameloop="demand"`
   * (ver Escena360) y con el teléfono apoyado en la mesa tiene que poder
   * dormirse igual que sin giroscopio.
   */
  const arrancarSesion = useCallback(() => {
    if (cuadro.current !== 0) return seguidor.state

    ultima.current = -1
    destino.current = { yaw: 0, pitch: 0 }
    const estado = seguidor.start()

    const bucle = () => {
      cuadro.current = requestAnimationFrame(bucle)
      const lectura = seguidor.reading
      if (lectura.updatedAt === ultima.current) return
      ultima.current = lectura.updatedAt

      const punto = destino.current
      if (punto === null) return
      const mirada = miradaDelSensor(lectura.suave)
      punto.yaw = mirada.yaw
      punto.pitch = mirada.pitch

      /* Solo a partir de la PRIMERA lectura de verdad se publica. Publicar el
         objeto recién creado, con sus ceros, haría que el rig calculara el
         desfase contra una dirección inventada y la vista pegara el salto que
         todo este mecanismo existe para evitar. */
      engine.input.absoluto = punto
      engine.invalidar()
    }
    cuadro.current = requestAnimationFrame(bucle)

    return estado
  }, [engine, seguidor])

  /** Deja el visor exactamente como estaba antes de encender. */
  const pararSesion = useCallback(() => {
    if (cuadro.current !== 0) cancelAnimationFrame(cuadro.current)
    cuadro.current = 0
    destino.current = null
    seguidor.stop()
    engine.input.absoluto = null
    engine.invalidar()
  }, [engine, seguidor])

  const apagar = useCallback(() => {
    if (!activoRef.current) return
    activoRef.current = false
    setActivo(false)
    pararSesion()
  }, [pararSesion])

  /* La política de un solo dueño, del lado de acá: el CameraRig avisa por aquí
     cuando el dedo, el joystick o el teclado le quitan la cámara al sensor. */
  useEffect(() => {
    engine.conectarGiroscopio(apagar)
    return () => engine.conectarGiroscopio(null)
  }, [engine, apagar])

  /* Si el seguidor se declara sin sensores —dos segundos sin una sola lectura—
     no hay nada que ofrecer: se apaga y el botón se retira. Es la guarda que
     corrige la apuesta de `puedeHaberSensores` en un navegador donde el evento
     existe pero nunca dispara. */
  useEffect(() => {
    seguidor.onStateChange = (estado) => {
      if (estado !== 'no-soportado') return
      setDisponible(false)
      apagar()
      avisar('Este aparato no reporta sensores de movimiento.')
    }
    return () => {
      seguidor.onStateChange = null
    }
  }, [seguidor, apagar, avisar])

  /**
   * Con la pantalla apagada o la app en segundo plano, el sensor se suelta.
   *
   * Un giroscopio escuchando es de las pocas cosas que gastan pila sin que se
   * vea nada, y el visor puede quedarse abierto en una pestaña durante horas.
   * Al volver se vuelve a arrancar, y como la sesión nueva trae un objeto nuevo
   * el CameraRig recalcula el desfase: la persona pudo haber caminado a otro
   * cuarto con el teléfono en el bolsillo, y sin recalcular la habitación
   * aparecería girada.
   */
  useEffect(() => {
    const alCambiarVisibilidad = () => {
      if (!activoRef.current) return
      if (document.visibilityState === 'hidden') pararSesion()
      else arrancarSesion()
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    return () => document.removeEventListener('visibilitychange', alCambiarVisibilidad)
  }, [arrancarSesion, pararSesion])

  /* Salir del visor apaga el sensor. Sin esto el giroscopio seguiría vivo en el
     editor o en la pantalla de inicio, gastando pila por nada. */
  useEffect(() => {
    return () => {
      window.clearTimeout(avisoTimer.current)
      activoRef.current = false
      pararSesion()
    }
  }, [pararSesion])

  const alternar = useCallback(() => {
    if (activoRef.current) {
      apagar()
      return
    }

    void (async () => {
      /* iOS 13+ solo abre el diálogo si la llamada sale de un gesto real. Este
         `await` está DESPUÉS de haber entrado por un click, que es lo que
         Safari mira; si esto se llamara desde un useEffect, el navegador
         rechazaría sin enseñar nada y la persona no sabría por qué no pasa
         nada. */
      if (needsOrientationPermission()) {
        const permiso = await requestOrientationPermission()
        if (permiso === 'denied') {
          /* Nada que deshacer: no se llegó a encender el sensor y el visor
             sigue con joystick y arrastre, igual que antes de tocar el botón. */
          avisar('Safari no dio permiso para los sensores. Se puede volver a permitir en Ajustes → Safari → Movimiento y orientación.')
          return
        }
      }

      const estado = arrancarSesion()
      if (estado === 'no-soportado') {
        setDisponible(false)
        pararSesion()
        avisar('Este aparato no reporta sensores de movimiento.')
        return
      }

      activoRef.current = true
      setActivo(true)
      avisar('Mueve el teléfono para mirar alrededor. Arrastra con el dedo para volver al control manual.')
    })()
  }, [apagar, arrancarSesion, pararSesion, avisar])

  return { disponible, activo, mensaje, alternar }
}

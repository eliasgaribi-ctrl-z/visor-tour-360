import * as THREE from 'three'
import { DEG, clamp, wrap180 } from '../math'

/**
 * ============================================================================
 *  ¿HACIA DÓNDE APUNTA LA CÁMARA DEL TELÉFONO?
 * ============================================================================
 *
 * Esta es la pieza que permite coser la panorámica: cada foto se pega en la
 * esfera en la dirección a la que el teléfono estaba apuntando al tomarla.
 *
 * ── De alpha/beta/gamma a un cuaternión ────────────────────────────────────
 *
 * El navegador entrega tres ángulos de Euler intrínsecos en orden Z-X'-Y'':
 *
 *   alpha  giro sobre el eje vertical.  0 = la punta del teléfono apunta al
 *          NORTE, y CRECE EN SENTIDO ANTIHORARIO visto desde arriba.
 *   beta   inclinación adelante/atrás.  0 = acostado boca arriba, 90 = vertical.
 *   gamma  ladeo izquierda/derecha.
 *
 * La conversión a un cuaternión de three.js es la referencia clásica de
 * DeviceOrientationControls, y tiene dos correcciones que no son evidentes:
 *
 *   q1 = giro de −90° sobre X  ·  sin esto la "vista" sale por la PUNTA del
 *        teléfono. Nosotros queremos la que sale por su ESPALDA, que es donde
 *        está la cámara trasera.
 *   q0 = giro de −(ángulo de pantalla) sobre Z · si el usuario gira el teléfono
 *        a horizontal, el sistema rota la pantalla pero NO los ejes del sensor;
 *        sin esta corrección el horizonte sale ladeado 90°.
 *
 * ── Verificado numéricamente ───────────────────────────────────────────────
 *
 *   plano sobre la mesa (β=0)      → pitch −90  (mira al piso)      ✓
 *   vertical al norte (α=0, β=90)  → yaw 0, pitch 0, sin ladeo      ✓
 *   α=90                           → yaw −90 (alpha va al revés)    ✓
 *   β=135                          → pitch +45 (mira hacia arriba)  ✓
 *   horizontal con pantalla a 90°  → roll 0 (horizonte derecho)     ✓
 *
 * ── Norte real ─────────────────────────────────────────────────────────────
 *
 * En iOS, `alpha` arranca en un valor arbitrario y va a la deriva, pero Safari
 * regala `webkitCompassHeading` (0 = norte, creciendo en sentido HORARIO). Como
 * alpha crece al revés, `alpha = 360 − heading` deja el norte en su lugar.
 * En Android el equivalente es el evento `deviceorientationabsolute`.
 */

const ZEE = new THREE.Vector3(0, 0, 1)
/** −90° sobre X: mueve la mirada de la punta del teléfono a su espalda. */
const Q_CAMERA = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2)

const scratchEuler = new THREE.Euler()
const scratchScreen = new THREE.Quaternion()

/** alpha/beta/gamma (grados) + ángulo de pantalla → orientación de la cámara trasera. */
export function deviceQuaternion(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenDeg: number,
  out = new THREE.Quaternion(),
): THREE.Quaternion {
  scratchEuler.set(betaDeg * DEG, alphaDeg * DEG, -gammaDeg * DEG, 'YXZ')
  out.setFromEuler(scratchEuler)
  out.multiply(Q_CAMERA)
  out.multiply(scratchScreen.setFromAxisAngle(ZEE, -screenDeg * DEG))
  return out
}

const FORWARD = new THREE.Vector3(0, 0, -1)
const UP = new THREE.Vector3(0, 1, 0)
const scratchVector = new THREE.Vector3()
const scratchInverse = new THREE.Quaternion()

/** Dirección a la que mira la cámara, en (yaw, pitch, roll) del proyecto. */
export function anglesOf(quaternion: THREE.Quaternion) {
  const forward = scratchVector.copy(FORWARD).applyQuaternion(quaternion)
  const yaw = Math.atan2(forward.x, -forward.z) / DEG
  const pitch = Math.asin(clamp(forward.y, -1, 1)) / DEG

  // Ladeo: dónde cae el "arriba" del mundo visto desde la cámara.
  // 0 = horizonte derecho. Sirve para avisar "endereza el teléfono".
  const up = scratchVector.copy(UP).applyQuaternion(scratchInverse.copy(quaternion).invert())
  const roll = Math.atan2(up.x, up.y) / DEG

  return { yaw, pitch, roll }
}

/** Ángulo entre dos orientaciones, en grados. Sirve para medir si está quieto. */
export function angleBetween(a: THREE.Quaternion, b: THREE.Quaternion): number {
  const dot = Math.abs(clamp(a.dot(b), -1, 1))
  return (2 * Math.acos(dot)) / DEG
}

/**
 * Ángulo de rotación de la pantalla, normalizado a 0/90/180/270.
 *
 * Solo afecta al LADEO de la foto, no a hacia dónde apunta: la corrección gira
 * alrededor del propio eje de la mirada, y ese eje no se mueve. O sea que si el
 * navegador no lo dice, la panorámica sigue quedando en el lugar correcto; lo
 * que se perdería es saber cómo enderezar cada toma. Por eso hay un respaldo
 * por la forma de la ventana en vez de rendirse con un 0.
 */
export function screenAngle(): number {
  const reportado =
    screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation
  if (typeof reportado === 'number') return ((reportado % 360) + 360) % 360
  return window.innerWidth > window.innerHeight ? 90 : 0
}

/* ========================================================================== */

export type OrientationState =
  /** Todavía no se pide nada. */
  | 'inactivo'
  /** El navegador no tiene los eventos (escritorio sin sensores, emulador). */
  | 'no-soportado'
  /** Falta que el usuario acepte el permiso (iOS). */
  | 'permiso-pendiente'
  /** El usuario dijo que no. */
  | 'denegado'
  /** Escuchando pero todavía no llega ninguna lectura. */
  | 'esperando'
  /** Llegando lecturas. */
  | 'activo'

export type OrientationReading = {
  /** Orientación de la cámara trasera en el mundo del visor, sin filtrar. */
  quaternion: THREE.Quaternion
  /** La misma, suavizada. Solo para la interfaz: el disparo usa la cruda. */
  suave: THREE.Quaternion
  yaw: number
  pitch: number
  roll: number
  /** Grados por segundo. Cerca de 0 = teléfono quieto. */
  speed: number
  /** Rumbo respecto al norte real (0 = norte, crece a la derecha), si se sabe. */
  heading: number | null
  /** La lectura está referida al norte y no a un cero arbitrario. */
  absolute: boolean
  /**
   * Milisegundos del último evento recibido, o `SIN_LECTURA` si de esta sesión
   * todavía no llegó ninguno. Quien lea `reading` en su propio bucle TIENE que
   * mirar esto antes de creerse los ángulos: recién construido el objeto —y
   * después de `stop()`— los campos traen ceros o la orientación de la sesión
   * anterior, que no significan nada.
   */
  updatedAt: number
}

/**
 * El valor de `updatedAt` que significa "todavía no hay ninguna lectura".
 *
 * Es 0 y no −1 porque es el mismo cero con el que nace el objeto: así el
 * arranque en frío y el regreso de segundo plano son exactamente el mismo caso
 * y no hay dos centinelas que puedan desincronizarse. `performance.now()` no
 * devuelve 0 en la práctica (el primer evento del sensor llega cientos de
 * milisegundos después de cargar la página); si por un imposible lo hiciera, el
 * único efecto sería saltarse esa lectura y usar la siguiente, 16 ms más tarde.
 */
export const SIN_LECTURA = 0

type IOSPermission = {
  requestPermission?: () => Promise<'granted' | 'denied' | 'prompt'>
}

/** ¿Este navegador pide permiso explícito para los sensores? (iOS 13+) */
export function needsOrientationPermission(): boolean {
  return (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof (DeviceOrientationEvent as unknown as IOSPermission).requestPermission === 'function'
  )
}

/**
 * Pide el permiso de sensores. TIENE que llamarse desde un gesto del usuario
 * (el handler de un click): si se llama al cargar la página, iOS la rechaza
 * sin mostrar nada.
 */
export async function requestOrientationPermission(): Promise<
  'granted' | 'denied' | 'prompt' | 'unsupported'
> {
  if (!needsOrientationPermission()) return 'unsupported'
  try {
    const result = await (DeviceOrientationEvent as unknown as IOSPermission).requestPermission!()
    /* `'prompt'` se devuelve tal cual y NO se dobla a `'denied'`. Significa que
       el diálogo se cerró sin decidir —un toque fuera, o el sistema que lo
       retiró—, y no que la persona haya dicho que no: nada quedó bloqueado y
       volver a tocar el botón vuelve a preguntar. Tratarlo como negado hacía
       que la app mandara a Ajustes → Safari a arreglar algo que no está roto. */
    if (result === 'granted' || result === 'prompt') return result
    return 'denied'
  } catch {
    // Safari lanza si no se llamó desde un gesto de usuario.
    return 'denied'
  }
}

/**
 * ============================================================================
 *  SEGUIDOR DE ORIENTACIÓN
 * ============================================================================
 *
 * Objeto mutable, igual que el tourEngine: los sensores disparan unos 60
 * eventos por segundo y ninguno debe provocar un render de React. Quien lo
 * necesite lee `tracker.reading` dentro de su propio requestAnimationFrame.
 *
 * ── Por qué se sigue el evento RELATIVO y no el absoluto ───────────────────
 *
 * Suena mejor `deviceorientationabsolute`: viene referido al norte real. Pero
 * ese dato lleva magnetómetro adentro, y un magnetómetro dentro de una casa se
 * brinca cinco o diez grados cada vez que pasa cerca de un marco de acero, una
 * bocina o el cableado del muro. Para coser una panorámica importa muchísimo
 * más que dos tomas seguidas sean consistentes ENTRE SÍ que saber dónde queda
 * el norte: un brinco del magnetómetro entre una foto y la siguiente se ve como
 * una pared partida.
 *
 * El evento relativo es giroscopio: suavísimo de una lectura a la otra, con una
 * deriva lenta que en el minuto que dura una captura no alcanza a importar.
 *
 * Así que se sigue el relativo, y el absoluto (o `webkitCompassHeading` en iOS)
 * se usa UNA sola vez, al principio, para anotar cuántos grados hay entre el
 * cero arbitrario del giroscopio y el norte real. Eso deja la panorámica
 * cosida con datos suaves y de todos modos orientada al norte.
 */

/** Cuántas lecturas de brújula se promedian para fijar el norte. */
const MUESTRAS_DE_NORTE = 12

export class OrientationTracker {
  state: OrientationState = 'inactivo'

  readonly reading: OrientationReading = {
    quaternion: new THREE.Quaternion(),
    suave: new THREE.Quaternion(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    speed: 0,
    heading: null,
    absolute: false,
    updatedAt: 0,
  }

  /** Se avisa solo cuando cambia el ESTADO, no en cada lectura. */
  onStateChange: ((state: OrientationState) => void) | null = null

  /**
   * Se avisa en CADA lectura, después de actualizar `reading`. Es para quien
   * necesita reaccionar al evento mismo y no puede esperar a su propio
   * requestAnimationFrame: el visor lo usa para mover la cámara sin abrir un
   * bucle de dibujo que siga vivo con el teléfono quieto (ver useGyroLook.ts).
   * La captura no lo usa: lee `reading` desde su rAF, como siempre.
   */
  onReading: (() => void) | null = null

  private previous = new THREE.Quaternion()
  private previousAt = 0
  private hasPrevious = false
  private waitTimer = 0
  private listening = false

  /** Diferencia entre el yaw del giroscopio y el norte real, en grados. */
  private norte: number | null = null
  private muestrasNorte: number[] = []
  /** Última lectura cruda del evento relativo, para casar con la brújula. */
  private yawRelativo = 0
  private hayRelativo = false

  private handleAbsolute = (event: DeviceOrientationEvent) => {
    // El evento absoluto NO se usa para seguir: solo aporta el norte.
    if (event.alpha === null || event.beta === null || event.gamma === null) return
    this.anotarNorte(360 - event.alpha)
    // Si el teléfono no entrega el evento relativo, este sirve de repuesto.
    if (!this.hayRelativo) this.consume(event, true)
  }

  private handleRelative = (event: DeviceOrientationEvent) => {
    if (event.alpha === null || event.beta === null || event.gamma === null) return
    this.hayRelativo = true
    this.consume(event, false)

    // El rumbo se anota DESPUÉS de consumir: iOS manda las dos cosas en el
    // mismo evento, y compararlo contra el yaw anterior metería el giro
    // ocurrido entre lecturas dentro del offset del norte.
    const compass = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
      .webkitCompassHeading
    if (typeof compass === 'number' && Number.isFinite(compass)) {
      this.anotarNorte(compass, true)
    }
  }

  /**
   * Guarda de dónde queda el norte.
   *
   * Se promedian las primeras lecturas y después se congela: si se siguiera
   * actualizando, cada brinco del magnetómetro movería el frente de la
   * panorámica a media captura.
   */
  private anotarNorte(rumbo: number, esRumbo = false) {
    if (this.norte !== null) return
    if (!this.hayRelativo && !esRumbo) return
    /* Solo con la pantalla en vertical: hay reportes de que en iOS el rumbo
       está referido a la PANTALLA y no al cuerpo del teléfono, así que al
       girarlo a horizontal el valor brinca 90°. Muestrear únicamente en
       vertical hace que el problema no exista, y como el norte solo sirve para
       etiquetar la escena, no perder nada si nunca se llega a muestrear. */
    if (screenAngle() !== 0) return

    const rumboNormalizado = ((rumbo % 360) + 360) % 360
    // La brújula dice hacia dónde apunta; el giroscopio dice cuánto giró desde
    // su cero. La diferencia es lo que hay que sumarle al yaw para tener norte.
    this.muestrasNorte.push(wrap180(rumboNormalizado - this.yawRelativo))

    if (this.muestrasNorte.length >= MUESTRAS_DE_NORTE) {
      const orden = [...this.muestrasNorte].sort((a, b) => a - b)
      // Mediana y no promedio: si una lectura salió disparada por un mueble
      // metálico, el promedio se la lleva y la mediana la ignora.
      this.norte = orden[Math.floor(orden.length / 2)]
      this.reading.absolute = true
    }
  }

  private setState(state: OrientationState) {
    if (this.state === state) return
    this.state = state
    this.onStateChange?.(state)
  }

  private consume(event: DeviceOrientationEvent, absolute: boolean) {
    const alpha = event.alpha
    if (alpha === null || event.beta === null || event.gamma === null) return

    const now = performance.now()
    const reading = this.reading

    deviceQuaternion(alpha, event.beta, event.gamma, screenAngle(), reading.quaternion)

    const angles = anglesOf(reading.quaternion)
    reading.yaw = angles.yaw
    reading.pitch = angles.pitch
    reading.roll = angles.roll
    reading.updatedAt = now
    this.yawRelativo = angles.yaw

    reading.heading = this.norte === null ? null : ((angles.yaw + this.norte) % 360 + 360) % 360
    if (absolute) reading.absolute = true

    if (this.hasPrevious) {
      const dt = Math.max(1, now - this.previousAt) / 1000
      const degrees = angleBetween(this.previous, reading.quaternion)
      // Media móvil: una sola lectura ruidosa no debe cancelar el disparo.
      reading.speed = reading.speed * 0.6 + (degrees / dt) * 0.4
      /* Versión suavizada SOLO para la interfaz. El disparo usa la cruda: una
         orientación con retraso pegaría la foto en el lugar equivocado.

         El lambda es adaptativo. Con uno fijo hay que elegir entre "la mira se
         arrastra mientras giras" y "la mira tiembla cuando intentas quedarte
         quieto"; subiéndolo con la velocidad se consiguen las dos cosas. */
      const lambda = 6 + Math.min(19, reading.speed * 0.5)
      reading.suave.slerp(reading.quaternion, Math.min(1, dt * lambda))
    } else {
      reading.suave.copy(reading.quaternion)
    }
    this.previous.copy(reading.quaternion)
    this.previousAt = now
    this.hasPrevious = true

    this.setState('activo')
    this.onReading?.()
  }

  /**
   * Empieza a escuchar. Devuelve el estado en el que quedó.
   * En iOS hay que haber concedido el permiso antes (ver requestOrientationPermission).
   */
  start(): OrientationState {
    if (this.listening) return this.state

    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
      this.setState('no-soportado')
      return this.state
    }

    window.addEventListener('deviceorientationabsolute', this.handleAbsolute as EventListener)
    window.addEventListener('deviceorientation', this.handleRelative)
    this.listening = true
    this.setState('esperando')

    /* Si en dos segundos no llegó ni un evento con datos, no hay sensores.
       No basta con preguntar si el evento existe: en Chrome de Android
       `ondeviceorientationabsolute` está definido aunque el teléfono no traiga
       magnetómetro, y entonces simplemente nunca dispara. */
    this.waitTimer = window.setTimeout(() => {
      if (this.state === 'esperando') this.setState('no-soportado')
    }, 2000)

    return this.state
  }

  stop() {
    if (!this.listening) return
    window.removeEventListener('deviceorientationabsolute', this.handleAbsolute as EventListener)
    window.removeEventListener('deviceorientation', this.handleRelative)
    window.clearTimeout(this.waitTimer)
    this.listening = false
    this.hasPrevious = false
    this.hayRelativo = false
    this.norte = null
    this.muestrasNorte = []

    /* La lectura se marca como caducada, y esto no es limpieza cosmética: es la
       diferencia entre volver de segundo plano bien o con la habitación girada.
       `stop()` se llama al ocultar la pestaña, y lo que queda en `reading` es la
       orientación de ANTES de guardarse el teléfono en el bolsillo —medido en el
       módulo real: tras `stop()`, `updatedAt` seguía valiendo 12345 y el yaw
       160°—. Quien vuelva a arrancar y lea eso en su primer cuadro se lo cree,
       ancla la vista contra una dirección de hace media hora, y a la primera
       lectura de verdad la habitación pega exactamente el giro que dio el
       teléfono mientras estaba oculto.

       `heading` y `absolute` van en el mismo lote porque su fuente, `norte`, se
       acaba de borrar dos líneas arriba: dejar `absolute: true` sin un norte
       detrás sería afirmar que la lectura mira al norte real cuando ya no lo
       sabe. */
    this.reading.updatedAt = SIN_LECTURA
    this.reading.heading = null
    this.reading.absolute = false

    this.setState('inactivo')
  }

  /** Grados que hay que sumarle al yaw para que 0 sea el norte real. */
  get offsetNorte(): number | null {
    return this.norte
  }
}

/**
 * Diferencia de yaw entre dos lecturas, por el camino corto.
 * Se usa para poner el "frente" de la panorámica en la primera toma.
 */
export const yawDelta = (from: number, to: number) => wrap180(to - from)

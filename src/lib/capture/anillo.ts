import * as THREE from 'three'

import { DEG, wrap180 } from '../math'
import { deltaYawMedido } from './frames'
import { anglesOf } from './orientation'

/**
 * ============================================================================
 *  CERRAR EL ANILLO: QUITARLE LA DERIVA AL GIROSCOPIO
 * ============================================================================
 *
 * El costurero pega cada toma donde dice el sensor. El sensor entrega el evento
 * `deviceorientation` RELATIVO, que se prefiere por una buena razón —el
 * magnetómetro brinca de cinco a diez grados junto a un marco de acero, y eso
 * partiría la panorámica por la mitad— pero que a cambio se va a la deriva: el
 * yaw se corre despacio mientras dura la captura.
 *
 * En el centro de la panorámica esa deriva no se ve, porque cada toma se pega
 * junto a su vecina y entre vecinas el error es diminuto. Donde aparece de
 * golpe es en el CIERRE: la última foto de la vuelta se pega junto a la
 * primera, y ahí sale toda la deriva de los 360° juntos, como una pared
 * partida. Es el defecto clásico de la captura asistida por sensores.
 *
 * Este archivo lo mide y devuelve cuánto hay que girar cada toma. No dibuja
 * nada y no toca el DOM: entra una lista de tomas y sale un número.
 *
 * ── Por qué NO se pueden comparar dos tomas vecinas tal cual ────────────────
 *
 * La idea obvia es medir el corrimiento de imagen entre dos tomas seguidas del
 * anillo con `deltaYawMedido()`. No funciona, y conviene dejar escrito por qué
 * antes de que alguien lo intente otra vez.
 *
 * El plan de captura avanza `hfov − 2 · tolerancia` entre foto y foto (ver
 * ./plan.ts), o sea unos 30° con el teléfono en VERTICAL, que es como se
 * sostiene y es el caso que importa. Y `deltaYawMedido` busca el corrimiento
 * dentro de una ventana del 45 % del ancho, que en ángulo son
 * `atan(0.9 · tan(hfov/2))`: con los 52° de campo horizontal que deja un
 * teléfono vertical, el tope son 23.7°. Treinta grados no caben en la ventana.
 *
 * Medido sobre una panorámica sintética de ruido multi-octava, con miniaturas
 * de 96×72 y cinco direcciones distintas por separación:
 *
 *     separación real   →   qué contesta deltaYawMedido (52° de campo)
 *          3°               3.0°   correlación 1.00
 *         10°              10.1°   correlación 0.99
 *         20°              19.8°   correlación 0.96
 *         25°              null    (corrimiento pegado al borde; correlación 0.89)
 *         30°              null    en 4 de 5 direcciones
 *
 * O sea que la correlación TODAVÍA es buenísima a 25° —0.89— y lo que falla es
 * que el corrimiento se sale de la ventana de búsqueda. Con el teléfono en
 * horizontal (66°) el tope sube a 30.3° y la cosa aguanta raspando, pero el
 * objetivo declarado del proyecto es un iPhone en la mano, en vertical.
 *
 * ── Lo que sí funciona: comparar dos tomas YA ENDEREZADAS ──────────────────
 *
 * En vez de comparar los fotogramas crudos, se vuelve a proyectar a cada uno
 * en una CÁMARA VIRTUAL común, colocada justo a la mitad entre las dos tomas y
 * sin ladeo, con el campo de visión de lo que las dos comparten. Es la misma
 * proyección gnomónica que hace el costurero, solo que a 96×72 y en el
 * procesador.
 *
 * Después de enderezarlas, si el giroscopio fuera perfecto las dos imágenes
 * coincidirían píxel a píxel. Lo que quede de corrimiento es EXACTAMENTE la
 * diferencia de deriva entre las dos tomas, y es un ángulo diminuto: décimas
 * de grado. O sea que `deltaYawMedido` trabaja justo en la parte de su rango
 * donde acierta con dos decimales, y de paso se le puede pasar `esperado: 0`,
 * que descarta cualquier pico falso sin más discusión.
 *
 * ── Qué significa cada número ───────────────────────────────────────────────
 *
 * Llamemos `e` al error del giroscopio en una toma: lo que el sensor reporta de
 * más respecto a hacia dónde apuntaba la cámara de verdad. El corrimiento
 * medido entre la toma A y la toma B enderezadas vale `e(A) − e(B)`, ni más ni
 * menos. Con eso hay DOS formas independientes de saber cuánta deriva se juntó
 * en toda la vuelta:
 *
 *   · LA CADENA. Se suman los residuos de todas las parejas vecinas, de la
 *     primera toma a la última. Sale la deriva de cada toma, no solo el total,
 *     y sale de muchas mediciones chicas en vez de una grande.
 *   · EL CIERRE. Se mide la pareja última-primera, que es la única que ve la
 *     vuelta entera de un golpe y es justo la de la pared partida. Se mide con
 *     la cadena ya descontada, así que lo que devuelve es lo que a la cadena se
 *     le escapó: un remate, no una segunda opinión.
 *
 * Ese remate tiene que ser chico. Que no lo sea quiere decir que alguna
 * medición se enganchó a un pico falso, y entonces no se aplica nada. Es una
 * comprobación cruzada que sale gratis y vale más que cualquier umbral.
 *
 * Ojo con una trampa aritmética que parece razonable y no lo es: sumar los
 * ángulos medidos de toda la vuelta y compararlos contra 360° NO detecta la
 * deriva. La suma de los saltos del propio giroscopio ya da 360° exactos por
 * construcción —es una vuelta cerrada— así que la resta solo mide el ruido de
 * las mediciones. La deriva no está repartida en esa suma: está concentrada
 * entera en la pareja del cierre.
 *
 * ── Qué tan bien mide, medido ───────────────────────────────────────────────
 *
 * Sobre la vuelta sintética de ./anillo.test.ts (teléfono en vertical, doce
 * tomas a 30°, ruido de cuatro octavas), inyectando la deriva a mano:
 *
 *     deriva puesta   deriva medida   peor toma fuera de sitio
 *          1°             0.99°               0.02°
 *          3°             2.99°               0.02°
 *          6°             5.99°               0.02°
 *         −6°            −6.01°               0.02°
 *
 * Y con el pulso de una mano de verdad encima: ±8° de puntería, ±8° de
 * inclinación y ±8° de ladeo a la vez, sale 6.01° con la peor toma a 0.41°; con
 * el teléfono ladeado hasta 15°, 5.99° con la peor a 0.79°, y ahí ya se caen dos
 * parejas de doce. Contra la panorámica de prueba de verdad (public/panoramas,
 * veinte tomas a 18°): 5.98° para 6°, −6.02° para −6°, y nada que corregir
 * cuando no hay deriva.
 *
 * ── Qué pasa si el fotograma viniera espejeado ──────────────────────────────
 *
 * Todo esto se apoya en que el eje X de la miniatura apunta a la derecha del
 * teléfono. Con `facingMode: environment` (./camera.ts) no viene espejeado, y
 * el volteo de la vista previa de la cámara frontal es de CSS y no toca el
 * lienzo, así que el caso no debería darse nunca. Conviene igual dejar escrito
 * qué pasaría, porque la explicación que parece obvia es falsa en las dos
 * direcciones y ya costó una revisión.
 *
 * Lo que NO pasa: "las dos imágenes no se parecerían". Sí se parecen —salen
 * espejadas igual las dos— y la correlación las casa sin problema. Y tampoco
 * pasa lo otro que suena razonable, que "solo cambiaría el signo".
 *
 * Lo que pasa de verdad sale de la cuenta de `enderezar()`. Con la toma
 * apuntando de verdad a `α` y el sensor diciendo `a = α + e`, la imagen
 * enderezada vale `escena(v + w − e)` con el fotograma normal, y
 * `escena(2α + e − v − w)` con el fotograma espejeado. Al comparar dos tomas
 * queda un corrimiento de `−2·(α_b − α_a) + (e_a − e_b)`: el error del sensor
 * conserva su signo y encima aparece el DOBLE del salto real entre las dos
 * tomas. Con las tomas del plan a 30° eso son 60° de corrimiento, muy fuera de
 * la ventana común y de la tolerancia de ±3° de una pareja.
 *
 * Medido con la vuelta sintética de la prueba, espejando las miniaturas: 0 de
 * 12 parejas medidas para derivas de 0.8°, 1.5°, 2°, 3° y 6° —o sea también en
 * la franja de 0.5° a 2° donde una corrección con el signo cambiado sí habría
 * hecho daño—, y la vuelta se cae en la pareja del cierre antes siquiera de
 * llegar a la guarda del 70 %. El control que aísla las dos cosas está en la
 * prueba: con todas las tomas apuntando al MISMO yaw el término del salto se
 * anula, las 12 parejas se miden espejadas y la cadena sale +3.00° igual que
 * sin espejo, que es la demostración de que el signo NO se voltea.
 *
 * Así que la protección existe, pero es la ventana de búsqueda y no el
 * parecido de las imágenes. El peor caso de este archivo sigue siendo no hacer
 * nada.
 */

/** Con menos tomas en el horizonte no hay vuelta que cerrar ni de dónde promediar. */
const MINIMO_TOMAS = 6

/**
 * Qué parte de las parejas tiene que haberse podido medir.
 *
 * Es una de las dos guardas que el dueño del proyecto pidió sin negociar. Un
 * cuarto de paredes lisas no da correlación en ningún lado, y ahí lo correcto
 * es quedarse como hoy y no inventar una corrección con tres mediciones.
 */
const FRACCION_MINIMA_MEDIDA = 0.7

/**
 * Tope de deriva que se acepta corregir, en grados.
 *
 * La otra guarda innegociable. Más de ocho grados en una vuelta no es deriva de
 * giroscopio: es que la correlación se enganchó a un pico falso, cosa típica en
 * una pared lisa o en un cuarto con un patrón que se repite (azulejo, librero,
 * persiana). Corregir con un número así desalinearía la vuelta entera en vez de
 * arreglar solo la unión, que es el peor resultado posible de todo esto.
 */
const DERIVA_MAXIMA = 8

/** Cuánto pueden diferir la cadena y el cierre antes de desconfiar de las dos. */
const DESACUERDO_MAXIMO = 4

/**
 * Por debajo de esto no vale la pena.
 *
 * Aplicar la corrección obliga a volver a coser las veinticinco tomas, y eso
 * son segundos de reloj con el velo de "espérame" puesto. Medio grado en el
 * cierre no se ve —es un píxel y medio en un lienzo de 4096— así que se cobra
 * la espera solo cuando hay algo que arreglar.
 */
const DERIVA_MINIMA = 0.5

/**
 * Cuánto puede moverse UNA toma más allá de lo que se movió la vuelta entera.
 *
 * `FRACCION_MINIMA_MEDIDA` y `DERIVA_MAXIMA` acotan la SUMA de la vuelta, no el
 * desplazamiento de una toma suelta, y no son lo mismo: la cadena puede irse a
 * +3° a media vuelta y volver, y entonces el cierre dice "aquí no pasó casi
 * nada" mientras la corrección de la toma del medio la manda tres grados lejos
 * de donde estaba. Un giroscopio no hace eso —el sesgo se integra, no va y
 * regresa en los cuarenta segundos que dura una vuelta— pero una correlación
 * enganchada a un azulejo repetido sí.
 *
 * La corrección de cada toma tiene que caer, con este margen, dentro de la
 * banda que va de 0 al cierre: la deriva empieza en cero en la primera toma y
 * termina en el cierre en la última, y en medio no tiene por qué salirse.
 * Medido sobre 25 vueltas sintéticas sanas —limpias, con pulso de mano de ±8°,
 * con una pareja caída, de 12 y de 20 tomas, con derivas de 0.6° a 8° en los
 * dos sentidos— el exceso sobre esa banda es 0.000° en TODAS. Grado y medio es
 * unas cuatro veces el peor error por toma que este archivo llegó a medir
 * (0.79°, con el teléfono ladeado 15°), y aun así rechaza el caso de arriba.
 */
const DESVIO_MAXIMO_POR_TOMA = 1.5

/**
 * Cuánto puede apartarse de cero el residuo de UNA pareja, en grados.
 *
 * Ocho grados de deriva repartidos en doce parejas son 0.67° por pareja, así
 * que tres es cuatro veces lo peor que cabe esperar y cualquier cosa por encima
 * es un pico falso. Vale también para la pareja del cierre, porque a esa se le
 * descuenta antes lo que dice la cadena: lo que se mide ahí es lo que sobra, no
 * la vuelta entera.
 */
const TOLERANCIA_PAR = 3

/** Recorte de seguridad en los bordes de la ventana común, en grados. */
const MARGEN_VENTANA = 1.5

/** Fracción de píxeles que puede quedarse fuera del fotograma al enderezar. */
const INVALIDOS_MAXIMOS = 0.05

/** Tamaño de las imágenes enderezadas. El mismo que las miniaturas de captura. */
const VIRTUAL = { ancho: 96, alto: 72 }

export type TomaMedible = {
  /** Orientación del teléfono al disparar, tal cual la entregó el sensor. */
  orientacion: THREE.Quaternion
  /** Miniatura en gris del fotograma, de `ancho`×`alto`. */
  grises: Float32Array
}

export type OpcionesDeriva = {
  /** Todas las tomas de la captura, en el orden en que se dispararon. */
  tomas: TomaMedible[]
  /** Tamaño de las miniaturas en gris. */
  ancho: number
  alto: number
  /** Campo de visión del FOTOGRAMA. La miniatura es el mismo campo, más chica. */
  hfov: number
  vfov: number
}

export type Deriva = {
  /** Grados que el yaw del sensor se corrió de más de punta a punta de la vuelta. */
  grados: number
  /**
   * Lo que hay que sumarle al giro de base de CADA toma, en los mismos grados y
   * en el mismo orden en que llegaron las tomas. Las que no se corrigen llevan
   * cero, así que quien cose no tiene que preguntar nada: suma y ya.
   */
  correcciones: number[]
}

export type MedicionDeAnillo = {
  /** `null` cuando no hay que corregir nada. Coser como siempre. */
  deriva: Deriva | null
  /** En una frase, qué pasó. Se imprime en la prueba de tools/pruebas. */
  motivo: string
  /** Tomas que quedaron dentro del anillo del horizonte. */
  tomasDelAnillo: number
  /** Parejas que hay en ese anillo: las vecinas más la del cierre. */
  pares: number
  /** De esas, cuántas se pudieron medir. */
  medidos: number
  /** Deriva según la cadena de parejas, y con el remate del cierre encima. */
  porCadena: number | null
  porCierre: number | null
}

/* --------------------------------------------------------------- ENDEREZAR */

/** El eje sobre el que gira el mundo. Girar aquí es corregir el yaw. */
const EJE_VERTICAL = new THREE.Vector3(0, 1, 0)

const escritorio = {
  matriz4: new THREE.Matrix4(),
  virtualAMundo: new THREE.Matrix3(),
  mundoACamara: new THREE.Matrix3(),
  virtualACamara: new THREE.Matrix3(),
  direccion: new THREE.Vector3(),
}

/**
 * Vuelve a proyectar una miniatura como la vería una cámara puesta en otra
 * orientación y con otro campo de visión.
 *
 * Es la misma cuenta del costurero (./stitcher.ts, el shader FRAGMENT) hecha en
 * el procesador y sobre siete mil píxeles en vez de ocho millones: para cada
 * píxel de la imagen nueva se saca su dirección, se pasa al espacio de la
 * cámara vieja y se lee ahí. Con interpolación bilineal, que aquí importa:
 * medio píxel de esta imagen vale una décima de grado y es del orden de lo que
 * se está tratando de medir.
 *
 * Devuelve `null` si demasiados píxeles caen FUERA del fotograma original. Los
 * pocos que caigan fuera se rellenan con el promedio de los que sí: así no
 * meten un borde falso que la correlación pueda confundir con estructura.
 */
function enderezar(
  fuente: Float32Array,
  ancho: number,
  alto: number,
  tanH: number,
  tanV: number,
  orientacion: THREE.Quaternion,
  virtual: THREE.Quaternion,
  tanHVirtual: number,
  tanVVirtual: number,
): Float32Array | null {
  const { matriz4, virtualAMundo, mundoACamara, virtualACamara, direccion } = escritorio

  virtualAMundo.setFromMatrix4(matriz4.makeRotationFromQuaternion(virtual))
  mundoACamara.setFromMatrix4(matriz4.makeRotationFromQuaternion(orientacion).invert())
  virtualACamara.multiplyMatrices(mundoACamara, virtualAMundo)

  const salida = new Float32Array(VIRTUAL.ancho * VIRTUAL.alto)
  const dentro = new Uint8Array(VIRTUAL.ancho * VIRTUAL.alto)
  let suma = 0
  let validos = 0

  for (let fila = 0; fila < VIRTUAL.alto; fila++) {
    const sy = 1 - ((fila + 0.5) / VIRTUAL.alto) * 2
    for (let columna = 0; columna < VIRTUAL.ancho; columna++) {
      const sx = ((columna + 0.5) / VIRTUAL.ancho) * 2 - 1
      const p = fila * VIRTUAL.ancho + columna

      direccion.set(sx * tanHVirtual, sy * tanVVirtual, -1).applyMatrix3(virtualACamara)
      // Detrás de la lente: esa dirección no es parte del fotograma.
      if (direccion.z > -1e-6) continue

      const u = direccion.x / -direccion.z / tanH
      const v = direccion.y / -direccion.z / tanV
      if (u < -1 || u > 1 || v < -1 || v > 1) continue

      // Fila 0 de la miniatura es la de ARRIBA, o sea el pitch más alto.
      const x = (u * 0.5 + 0.5) * ancho - 0.5
      const y = (0.5 - v * 0.5) * alto - 0.5
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const fx = x - x0
      const fy = y - y0
      const xa = x0 < 0 ? 0 : x0 > ancho - 1 ? ancho - 1 : x0
      const xb = x0 + 1 < 0 ? 0 : x0 + 1 > ancho - 1 ? ancho - 1 : x0 + 1
      const ya = y0 < 0 ? 0 : y0 > alto - 1 ? alto - 1 : y0
      const yb = y0 + 1 < 0 ? 0 : y0 + 1 > alto - 1 ? alto - 1 : y0 + 1

      const arriba = fuente[ya * ancho + xa] * (1 - fx) + fuente[ya * ancho + xb] * fx
      const abajo = fuente[yb * ancho + xa] * (1 - fx) + fuente[yb * ancho + xb] * fx
      const valor = arriba * (1 - fy) + abajo * fy

      salida[p] = valor
      dentro[p] = 1
      suma += valor
      validos++
    }
  }

  const total = VIRTUAL.ancho * VIRTUAL.alto
  if (validos === 0) return null
  if (total - validos > total * INVALIDOS_MAXIMOS) return null

  if (validos < total) {
    const promedio = suma / validos
    for (let p = 0; p < total; p++) if (!dentro[p]) salida[p] = promedio
  }
  return salida
}

/* ------------------------------------------------------------- UNA PAREJA */

type Angulos = { yaw: number; pitch: number; roll: number }

/**
 * Cuánto se equivocó el giroscopio ENTRE estas dos tomas, en grados.
 *
 * El resultado es `e(a) − e(b)`: lo que el sensor le sumó de más a la primera
 * respecto de la segunda. Con el sensor perfecto sale cero.
 *
 * Devuelve `null` cuando la pareja no se puede medir: no se traslapan lo
 * suficiente, una de las dos no se pudo enderezar, la correlación quedó por
 * debajo del mínimo, o el residuo salió tan grande que solo puede ser un pico
 * falso.
 */
function residuoDelPar(
  a: TomaMedible,
  b: TomaMedible,
  anguloA: Angulos,
  anguloB: Angulos,
  opciones: OpcionesDeriva,
  tolerancia: number,
): number | null {
  const { ancho, alto, hfov, vfov } = opciones

  const salto = wrap180(anguloB.yaw - anguloA.yaw)
  const saltoPitch = anguloB.pitch - anguloA.pitch

  /* La cámara virtual se planta a la mitad del camino y sin ladeo. Lo de "sin
     ladeo" no es cosmético: la correlación solo sabe buscar corrimientos
     horizontales, así que las dos imágenes tienen que llegarle con el horizonte
     recto y en el mismo sitio. */
  const yawVirtual = anguloA.yaw + salto / 2
  const pitchVirtual = anguloA.pitch + saltoPitch / 2
  const virtual = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pitchVirtual * DEG, -yawVirtual * DEG, 0, 'YXZ'),
  )

  // Lo que las dos tomas comparten, menos un recorte de seguridad en cada orilla.
  const hfovVirtual = hfov - Math.abs(salto) - 2 * MARGEN_VENTANA
  if (hfovVirtual < 4) return null

  /* En vertical no se puede llegar hasta `vfov/2`: en las ESQUINAS un
     fotograma rectilíneo se pincha hacia adentro, y la ventana común está justo
     en la orilla de las dos tomas, que es donde el pinchazo es mayor. El límite
     honesto es la altura de la esquina. */
  const tanH = Math.tan((hfov * DEG) / 2)
  const tanV = Math.tan((vfov * DEG) / 2)
  const esquina = Math.asin(tanV / Math.sqrt(tanH * tanH + tanV * tanV + 1)) / DEG
  const vfovVirtual = 2 * esquina - Math.abs(saltoPitch) - 2 * MARGEN_VENTANA
  if (vfovVirtual < 4) return null

  const tanHVirtual = Math.tan((hfovVirtual * DEG) / 2)
  const tanVVirtual = Math.tan((vfovVirtual * DEG) / 2)

  const rectaA = enderezar(
    a.grises, ancho, alto, tanH, tanV, a.orientacion, virtual, tanHVirtual, tanVVirtual,
  )
  if (!rectaA) return null
  const rectaB = enderezar(
    b.grises, ancho, alto, tanH, tanV, b.orientacion, virtual, tanHVirtual, tanVVirtual,
  )
  if (!rectaB) return null

  const medido = deltaYawMedido({
    anterior: rectaA,
    actual: rectaB,
    width: VIRTUAL.ancho,
    height: VIRTUAL.alto,
    focalPx: VIRTUAL.ancho / (2 * tanHVirtual),
    // Ya están enderezadas: lo que quede tiene que ser casi cero.
    esperado: 0,
    tolerancia,
    pitch: pitchVirtual,
    roll: 0,
  })

  return medido ? medido.grados : null
}

/* ----------------------------------------------------------- TODA LA VUELTA */

/**
 * Mide cuánta deriva juntó el giroscopio en la vuelta del horizonte y reparte
 * la corrección entre todas las tomas.
 *
 * No lanza nunca y no modifica nada de lo que recibe. Si algo no cuadra
 * devuelve `deriva: null` con el motivo, y quien llama cose como si este
 * archivo no existiera.
 *
 * ── Por qué la vuelta se recorre en orden de DISPARO y no de yaw ────────────
 *
 * Lo natural es ordenar las tomas por yaw, que es como se ven en la
 * panorámica. Está mal por dos razones. La primera es de fondo: la deriva es
 * función del TIEMPO —el sesgo del sensor se va integrando— así que la
 * corrección de una toma depende de cuándo se disparó, no de hacia dónde
 * apuntaba. La segunda es práctica y se ve en la prueba: el disparador acepta
 * una foto con hasta 11° de desvío respecto del punto marcado, así que con la
 * puntería normal de una mano una toma temprana puede acabar con un yaw
 * apenitas MENOR que el de la primera, y ordenando por yaw se va al final de la
 * fila y se lleva la corrección entera. Medido sobre la vuelta sintética con
 * ±8° de desvío: esa toma salía 5.5° fuera de lugar, casi el doble de daño que
 * la deriva que se estaba arreglando.
 *
 * En una vuelta normal las dos ordenaciones son la misma —se barre el anillo de
 * corrido— y donde no lo son, el orden de disparo se protege solo: dos tomas
 * seguidas en el tiempo que no se traslapan no se pueden medir, la pareja se
 * cae, y con suficientes caídas la guarda del 70 % corta.
 *
 * ── El cierre no se promedia con la cadena: la remata ───────────────────────
 *
 * Primero se encadenan las parejas vecinas, y eso da una estimación de la
 * deriva en cada toma. Después, para medir el cierre, a la última toma se le
 * aplica ANTES esa estimación: así las dos imágenes del cierre llegan a la
 * correlación casi alineadas, que es donde mide bien, y lo que sobra es
 * exactamente lo que a la cadena se le escapó. Sumarlo es lo que arregla los
 * dos casos feos: la cadena a la que le faltó una pareja (recupera el pedazo
 * perdido) y la deriva negativa, que separa las dos tomas del cierre y deja
 * menos traslape del que la correlación necesitaría si tuviera que medir el
 * error entero de un golpe.
 *
 * Y ese sobrante es, gratis, la comprobación cruzada: si la cadena y el cierre
 * no se parecen, alguna medición se enganchó donde no debía y no se aplica nada.
 *
 * Lo que cuesta todo esto: una vuelta de doce tomas se mide en unos 30 ms en una
 * laptop, o sea unas décimas de segundo en un teléfono. Se paga con el velo de
 * "armando la foto" ya puesto y antes de un recosido que tarda segundos.
 */
export function medirDeriva(opciones: OpcionesDeriva): MedicionDeAnillo {
  const { tomas, vfov } = opciones

  const vacio = {
    deriva: null,
    tomasDelAnillo: 0,
    pares: 0,
    medidos: 0,
    porCadena: null,
    porCierre: null,
  }

  if (tomas.length < MINIMO_TOMAS) {
    return { ...vacio, motivo: `solo hay ${tomas.length} tomas en total` }
  }

  /* El anillo del horizonte es el que cierra la vuelta y el único con tomas
     suficientes para promediar. Los de arriba y abajo tienen la mitad y están
     llenos de techo liso; ahí la correlación no tiene de dónde agarrarse.
     `filter` conserva el orden de la lista, que es el orden de disparo. */
  const angulos = tomas.map((toma) => anglesOf(toma.orientacion))
  const anillo = tomas
    .map((toma, indice) => ({ toma, indice, angulo: angulos[indice] }))
    .filter((entrada) => Math.abs(entrada.angulo.pitch) < vfov / 2)

  const n = anillo.length
  if (n < MINIMO_TOMAS) {
    return { ...vacio, motivo: `el anillo del horizonte tiene ${n} tomas` }
  }

  /* La cadena. Cada residuo vale `e(k) − e(k+1)`, así que la suma acumulada con
     el signo cambiado es la deriva de cada toma respecto de la primera, que por
     definición vale cero: la primera toma es la que fija el frente de la
     panorámica y el rumbo que se escribe en los metadatos, y moverla giraría
     todo lo demás sin necesidad. */
  const acumulada = [0]
  /** Parejas `k → k+1` que no se pudieron medir. Ahí es donde se perdió deriva. */
  const sinMedir: number[] = []
  let medidos = 0
  for (let k = 0; k < n - 1; k++) {
    const residuo = residuoDelPar(
      anillo[k].toma,
      anillo[k + 1].toma,
      anillo[k].angulo,
      anillo[k + 1].angulo,
      opciones,
      TOLERANCIA_PAR,
    )
    // La pareja que no se pudo medir cuenta como cero: se pierde el pedazo de
    // deriva de ese tramo, no se inventa ninguno. El cierre lo recupera.
    if (residuo !== null) medidos++
    else sinMedir.push(k)
    acumulada.push(acumulada[k] - (residuo ?? 0))
  }

  const cadena = acumulada[n - 1]
  const base = { tomasDelAnillo: n, pares: n, medidos, porCadena: cadena, porCierre: null }

  if (Math.abs(cadena) > 2 * DERIVA_MAXIMA) {
    return {
      ...base,
      deriva: null,
      motivo: `la cadena suma ${cadena.toFixed(1)}°, que ya no es deriva de nada`,
    }
  }

  /* El cierre, con la última toma ya adelantada lo que dice la cadena. Girar la
     orientación por delante es exactamente lo que hará el costurero al pegarla:
     así se mide lo que quedaría MAL después de corregir, que es lo único que
     hace falta saber. */
  const ultima = anillo[n - 1]
  const enderezada = new THREE.Quaternion()
    .setFromAxisAngle(EJE_VERTICAL, cadena * DEG)
    .multiply(ultima.toma.orientacion)
  const sobra = residuoDelPar(
    { orientacion: enderezada, grises: ultima.toma.grises },
    anillo[0].toma,
    anglesOf(enderezada),
    anillo[0].angulo,
    opciones,
    TOLERANCIA_PAR,
  )

  if (sobra === null) {
    return {
      ...base,
      deriva: null,
      motivo: `la pareja del cierre no se pudo medir (cadena ${cadena.toFixed(2)}°)`,
    }
  }
  medidos++

  const cierre = cadena + sobra
  const conMedidas = { ...base, medidos, porCierre: cierre }

  if (medidos < n * FRACCION_MINIMA_MEDIDA) {
    return {
      ...conMedidas,
      deriva: null,
      motivo: `solo se midieron ${medidos} de ${n} parejas (hace falta el ${Math.round(FRACCION_MINIMA_MEDIDA * 100)} %)`,
    }
  }
  if (Math.abs(sobra) > DESACUERDO_MAXIMO) {
    return {
      ...conMedidas,
      deriva: null,
      motivo: `la cadena dice ${cadena.toFixed(1)}° y el cierre ${cierre.toFixed(1)}°: no se parecen`,
    }
  }
  if (Math.abs(cierre) > DERIVA_MAXIMA) {
    return {
      ...conMedidas,
      deriva: null,
      motivo: `${cierre.toFixed(1)}° es demasiado para ser deriva; huele a pico falso`,
    }
  }
  if (Math.abs(cierre) < DERIVA_MINIMA) {
    return {
      ...conMedidas,
      deriva: null,
      motivo: `${cierre.toFixed(2)}° de deriva: no se ve, no se toca`,
    }
  }

  /* Lo que el cierre dijo que faltaba se reparte a lo largo de la cadena, en vez
     de dejárselo entero a la última toma: si se le colgara ahí, la unión
     quedaría perfecta y aparecería un escalón nuevo entre las dos últimas.

     Y se reparte donde de verdad se perdió, no a lo largo de toda la vuelta:
     `sobra` es exactamente el pedazo de deriva que la cadena no vio, y la
     cadena solo deja de ver en las parejas que no se pudieron medir. Repartirlo
     linealmente en el índice mueve tomas cuyo tramo SÍ se midió bien; medido
     sobre una vuelta con la deriva concentrada en un tramo ciego de dos tomas,
     el reparto lineal dejaba la peor toma 1.16° fuera de sitio —más que
     cualquier caso documentado arriba— y este reparto la deja en 0.

     Cuando no faltó ninguna pareja, `sobra` es la basura acumulada de todas las
     mediciones y ahí sí toca repartirla pareja: linealmente en el índice.

     Nota de que las dos reglas son la misma: con deriva uniforme, cada pareja
     que falta pierde `D/(n−1)`, así que `sobra = (parejas caídas)·D/(n−1)` y
     darle a cada una su parte igual devuelve exactamente `D/(n−1)`. */
  const reparto = new Array<number>(n).fill(0)
  if (sinMedir.length > 0) {
    const porPareja = sobra / sinMedir.length
    for (const k of sinMedir) {
      // La pareja `k → k+1` se salta ese escalón: lo cargan de k+1 en adelante.
      for (let j = k + 1; j < n; j++) reparto[j] += porPareja
    }
  } else {
    for (let k = 0; k < n; k++) reparto[k] = (sobra * k) / (n - 1)
  }

  /* La guarda del desplazamiento por toma. La deriva vale cero en la primera
     toma y `cierre` en la última, así que ninguna corrección tiene por qué
     salirse de esa banda; la que se sale delata una cadena que se fue y volvió,
     que es correlación enganchada y no giroscopio (ver DESVIO_MAXIMO_POR_TOMA). */
  const bajo = Math.min(0, cierre) - DESVIO_MAXIMO_POR_TOMA
  const alto = Math.max(0, cierre) + DESVIO_MAXIMO_POR_TOMA
  let fuera: number | null = null
  for (let k = 0; k < n; k++) {
    const correccion = acumulada[k] + reparto[k]
    if (correccion < bajo || correccion > alto) {
      if (fuera === null || Math.abs(correccion) > Math.abs(fuera)) fuera = correccion
    }
  }
  if (fuera !== null) {
    return {
      ...conMedidas,
      deriva: null,
      motivo: `una toma se movería ${fuera.toFixed(1)}° con la vuelta corrida solo ${cierre.toFixed(1)}°: eso no es deriva`,
    }
  }

  const correcciones = new Array<number>(tomas.length).fill(0)
  const delAnillo = new Set<number>()
  for (let k = 0; k < n; k++) {
    correcciones[anillo[k].indice] = acumulada[k] + reparto[k]
    delAnillo.add(anillo[k].indice)
  }

  /* Las tomas de los otros anillos heredan la corrección de la toma del
     horizonte que apunte más cerca en yaw. No es exacto —se tomaron en otro
     momento, con otra deriva— pero es lo que mantiene alineada la unión
     vertical, que es la que se ve: una toma del techo pegada con una corrección
     distinta a la de la pared que tiene debajo abre una costura donde no la
     había. */
  for (let i = 0; i < tomas.length; i++) {
    if (delAnillo.has(i)) continue
    let mejor = 0
    let distancia = Infinity
    for (const entrada of anillo) {
      const cuanto = Math.abs(wrap180(angulos[i].yaw - entrada.angulo.yaw))
      if (cuanto < distancia) {
        distancia = cuanto
        mejor = correcciones[entrada.indice]
      }
    }
    correcciones[i] = mejor
  }

  return {
    ...conMedidas,
    deriva: { grados: cierre, correcciones },
    motivo: `${cierre.toFixed(2)}° repartidos en ${n} tomas del anillo (cadena ${cadena.toFixed(2)}°, remate del cierre ${sobra.toFixed(2)}°)`,
  }
}

import { DEG } from '../math'

/**
 * ============================================================================
 *  DE LA CÁMARA A UNA TOMA UTILIZABLE
 * ============================================================================
 *
 * Congelar el fotograma, medir su brillo y —lo más interesante— averiguar cuál
 * es el campo de visión real de la cámara de ESTE teléfono.
 */

/**
 * Campo de visión del LADO LARGO del fotograma, por defecto.
 *
 * Ningún navegador dice cuál es: `getSettings()` entrega resolución y cuadros
 * por segundo, y `getCapabilities()` no incluye nada de la lente. 66°
 * corresponde a un equivalente de 26 mm, que es lo que trae la cámara principal
 * de casi cualquier teléfono de los últimos años.
 *
 * Se define sobre el lado LARGO y no sobre el horizontal porque el fotograma
 * cambia de forma según cómo se sostenga el teléfono: en vertical, el lado
 * largo del sensor queda arriba-abajo y el campo ancho pasa a ser el vertical.
 *
 * Es un punto de partida: durante la captura se corrige solo con el giroscopio
 * (ver `estimarFovConGiro`).
 */
export const FOV_LADO_LARGO = 66

export type Fov = { hfov: number; vfov: number }

/** Campos horizontal y vertical de un fotograma, a partir de su forma. */
export function fovDe(width: number, height: number, fovLadoLargo = FOV_LADO_LARGO): Fov {
  const largo = Math.max(width, height)
  const corto = Math.min(width, height)
  const tanLargo = Math.tan((fovLadoLargo * DEG) / 2)
  const fovCorto = (2 * Math.atan(tanLargo * (corto / largo))) / DEG
  return width >= height
    ? { hfov: fovLadoLargo, vfov: fovCorto }
    : { hfov: fovCorto, vfov: fovLadoLargo }
}

/** Al revés: de un campo horizontal medido, el del lado largo. */
export function ladoLargoDesdeHorizontal(hfovDeg: number, width: number, height: number): number {
  if (width >= height) return hfovDeg
  const tanH = Math.tan((hfovDeg * DEG) / 2)
  return (2 * Math.atan(tanH * (height / width))) / DEG
}

export function crearLienzo(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** Libera un canvas grande. En iOS el presupuesto total de canvas es chico. */
export function soltarLienzo(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

/**
 * ¿Este navegador puede con un lienzo de este tamaño?
 *
 * Safari en iOS tiene un tope de 16 777 216 píxeles por canvas y un presupuesto
 * de memoria compartido entre todos los que estén vivos. Lo peligroso es que al
 * pasarse NO lanza ningún error: entrega el lienzo EN BLANCO. Sin esta prueba,
 * el recorrido se guardaría todo negro y no habría ni una línea en la consola
 * que lo explicara.
 *
 * La prueba es pintar un píxel y volver a leerlo.
 */
export function lienzoUtilizable(width: number, height: number): boolean {
  const canvas = crearLienzo(width, height)
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(width - 1, height - 1, 1, 1)
    const { data } = ctx.getImageData(width - 1, height - 1, 1, 1)
    return data[0] > 200 && data[1] < 60
  } catch {
    return false
  } finally {
    soltarLienzo(canvas)
  }
}

/** Tamaños de panorámica de mayor a menor. Se baja hasta que uno pase la prueba. */
export const ANCHOS_PANORAMICA = [4096, 3072, 2048, 1024]

/** El lienzo más grande que este teléfono aguanta de verdad. */
export function anchoUtilizable(maximo = 4096): number {
  for (const ancho of ANCHOS_PANORAMICA) {
    if (ancho > maximo) continue
    if (lienzoUtilizable(ancho, ancho / 2)) return ancho
  }
  return 1024
}

/**
 * Congela el fotograma actual del video en un canvas.
 *
 * Se limita el ancho porque no aporta nada tener tomas de 4000 px si la
 * panorámica final mide 4096 de circunferencia completa: cada toma cubre unos
 * 66°, o sea menos de la quinta parte del ancho final.
 */
export function capturarFotograma(video: HTMLVideoElement, anchoMaximo = 1600): HTMLCanvasElement {
  const escala = Math.min(1, anchoMaximo / (video.videoWidth || anchoMaximo))
  const width = Math.max(1, Math.round((video.videoWidth || anchoMaximo) * escala))
  const height = Math.max(1, Math.round((video.videoHeight || anchoMaximo) * escala))

  const canvas = crearLienzo(width, height)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('No se pudo preparar el lienzo de la toma.')
  ctx.drawImage(video, 0, 0, width, height)
  return canvas
}

/**
 * Brillo medio (0…1) de una imagen, para igualar la exposición entre tomas.
 * Se mide sobre una miniatura de 32×32: 1024 píxeles bastan para una media y
 * evitan leer millones desde la GPU.
 */
export function brilloDe(fuente: CanvasImageSource, muestra = 32): number {
  const canvas = crearLienzo(muestra, muestra)
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  if (!ctx) return 0.5
  ctx.drawImage(fuente, 0, 0, muestra, muestra)
  const { data } = ctx.getImageData(0, 0, muestra, muestra)

  let suma = 0
  for (let i = 0; i < data.length; i += 4) {
    // Luminancia perceptual (Rec. 709).
    suma += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  }
  return suma / (muestra * muestra * 255)
}

/** Versión en escala de grises y reducida, para comparar dos tomas. */
export function grisesReducidos(
  fuente: CanvasImageSource,
  width: number,
  height: number,
): Float32Array {
  const canvas = crearLienzo(width, height)
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })
  if (!ctx) return new Float32Array(width * height)
  ctx.drawImage(fuente, 0, 0, width, height)
  const { data } = ctx.getImageData(0, 0, width, height)

  const salida = new Float32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    salida[p] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
  }
  return salida
}

export type Desplazamiento = {
  /** Corrimiento horizontal en píxeles de la imagen reducida, con subpíxel. */
  pixeles: number
  /** Qué tan confiable es (correlación normalizada, −1…1). */
  confianza: number
}

/**
 * Busca cuánto se corrió horizontalmente la imagen entre dos tomas.
 *
 * Correlación cruzada normalizada sobre una banda central de filas: se prueba
 * cada corrimiento y se queda con el que más se parece. La banda central se usa
 * porque el techo y el piso de un cuarto suelen ser lisos y no aportan nada
 * para alinear; la pared del medio sí tiene esquinas, cuadros y muebles.
 *
 * El pico se afina con una parábola sobre sus dos vecinos. Sin eso, la
 * resolución de la medida es de un píxel entero de la imagen reducida, que a
 * este tamaño vale casi un grado: el error de redondeo solo ya sería más grande
 * que lo que se está tratando de medir.
 *
 * ── Para qué sirve recortar también las COLUMNAS ───────────────────────────
 *
 * Un giro no corre la imagen en bloque: la perspectiva la estira hacia una
 * orilla y la comprime en la otra, así que cada columna se corrió una cantidad
 * distinta y la correlación devuelve un promedio de todas ellas, no el
 * corrimiento del centro. Para alinear dos tomas ese promedio está bien —es
 * justo el mejor encaje global— pero para MEDIR la distancia focal no sirve,
 * porque quien manda ahí es el centro.
 *
 * Por eso el parámetro: quien alinea deja `fraccionColumnas` en 1 y usa la
 * imagen entera; quien calibra pide la franja central. Simulado sobre una
 * panorámica sintética de 96×72 con un lente real de 66°: con la imagen
 * completa la cuenta sale entre 61° y 65° según cuánto se haya girado, y con el
 * 40 % central sale entre 64.3° y 66.1° en todo el rango de giro útil.
 */
export function desplazamientoHorizontal(
  a: Float32Array,
  b: Float32Array,
  width: number,
  height: number,
  maximo = Math.floor(width * 0.45),
  fraccionColumnas = 1,
): Desplazamiento {
  const filaInicial = Math.floor(height * 0.25)
  const filaFinal = Math.ceil(height * 0.75)
  // Nunca menos de 8 columnas: por debajo de eso la parábola del subpíxel se
  // apoya en ruido y el afinado empeora la medida en vez de mejorarla.
  const anchoVentana = Math.max(
    Math.min(8, width),
    Math.round(width * Math.min(1, Math.max(0.1, fraccionColumnas))),
  )
  const columnaInicial = Math.floor((width - anchoVentana) / 2)
  const columnaFinal = columnaInicial + anchoVentana
  const minimoTraslape = anchoVentana * (filaFinal - filaInicial) * 0.35

  const puntajes = new Float32Array(2 * maximo + 1).fill(-2)
  let mejor = 0
  let mejorPuntaje = -2

  for (let corrimiento = -maximo; corrimiento <= maximo; corrimiento++) {
    let sumaA = 0
    let sumaB = 0
    let sumaAA = 0
    let sumaBB = 0
    let sumaAB = 0
    let n = 0

    for (let fila = filaInicial; fila < filaFinal; fila++) {
      const base = fila * width
      const desde = Math.max(columnaInicial, -corrimiento)
      const hasta = Math.min(columnaFinal, width - corrimiento)
      for (let columna = desde; columna < hasta; columna++) {
        const va = a[base + columna]
        const vb = b[base + columna + corrimiento]
        sumaA += va
        sumaB += vb
        sumaAA += va * va
        sumaBB += vb * vb
        sumaAB += va * vb
        n++
      }
    }

    // Con poco traslape la correlación se vuelve ruido con puntaje alto.
    if (n < minimoTraslape) continue

    const mediaA = sumaA / n
    const mediaB = sumaB / n
    const covarianza = sumaAB / n - mediaA * mediaB
    const varianzaA = sumaAA / n - mediaA * mediaA
    const varianzaB = sumaBB / n - mediaB * mediaB
    const denominador = Math.sqrt(Math.max(varianzaA, 1e-9) * Math.max(varianzaB, 1e-9))
    const puntaje = covarianza / denominador

    puntajes[corrimiento + maximo] = puntaje
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje
      mejor = corrimiento
    }
  }

  // Afinado subpíxel: vértice de la parábola que pasa por el pico y sus vecinos.
  let afinado = mejor
  const i = mejor + maximo
  if (i > 0 && i < puntajes.length - 1) {
    const izquierda = puntajes[i - 1]
    const derecha = puntajes[i + 1]
    if (izquierda > -2 && derecha > -2) {
      const curvatura = izquierda - 2 * mejorPuntaje + derecha
      if (Math.abs(curvatura) > 1e-6) {
        const ajuste = (0.5 * (izquierda - derecha)) / curvatura
        if (Math.abs(ajuste) <= 1) afinado = mejor + ajuste
      }
    }
  }

  return { pixeles: afinado, confianza: mejorPuntaje }
}

/**
 * ============================================================================
 *  CALIBRAR EL CAMPO DE VISIÓN CON EL GIROSCOPIO
 * ============================================================================
 *
 * Sabemos cuánto GIRÓ el teléfono entre dos tomas (los sensores lo dicen) y
 * podemos medir cuánto se CORRIÓ la imagen (correlación). Con esos dos datos
 * sale la distancia focal, y de ahí el campo de visión:
 *
 *   corrimiento_px = f · tan(Δángulo)      →      f = corrimiento_px / tan(Δángulo)
 *   hfov = 2 · atan( ancho / (2 · f) )
 *
 * Es la misma calibración que hace una cámara al medir un patrón conocido, solo
 * que aquí el patrón es el propio cuarto y la referencia la pone el giroscopio.
 *
 * ── Por qué solo sirve con giros CHICOS ────────────────────────────────────
 *
 * La correlación supone que la imagen se DESPLAZÓ, y eso solo es cierto de a
 * poquito: una lente proyecta en perspectiva, así que al girar mucho el
 * contenido además se estira hacia una orilla y se comprime en la otra.
 * Medido sobre panorámicas reales: con 15° de giro la correlación baja a 0.5,
 * con 25° a 0.3 y con 35° ya es ruido. Por eso la medición se toma DURANTE el
 * barrido, entre lecturas separadas unos pocos grados, y no entre dos fotos del
 * plan, que van a más de 30° una de otra.
 *
 * Devuelve null si la medición no es confiable: pared lisa, giro fuera del
 * rango útil, o un resultado fuera de lo que cualquier teléfono puede tener.
 */

/**
 * Fracción central de columnas con la que se mide el corrimiento al calibrar.
 * Ver el comentario de `desplazamientoHorizontal` sobre por qué no se usa la
 * imagen completa.
 */
const VENTANA_CALIBRACION = 0.4

/** Hasta dónde puede estar inclinado el eje óptico para que la medición valga. */
const PITCH_MAXIMO = 6
/** Hasta dónde puede estar ladeado el teléfono. */
const ROLL_MAXIMO = 8

/**
 * Por debajo de esta correlación la medida no es una medida.
 *
 * Es el mismo número para calibrar el lente y para medir un giro, y a propósito:
 * las dos cosas se apoyan en el mismo pico de la misma correlación, así que si
 * un cuarto de paredes lisas no da para una, tampoco da para la otra.
 */
const CONFIANZA_MINIMA = 0.45

export function estimarFovConGiro(params: {
  anterior: Float32Array
  actual: Float32Array
  width: number
  height: number
  /** Cuánto giró el teléfono en horizontal entre las dos tomas, en grados. */
  deltaYaw: number
  /** Cuánto cambió la inclinación. Si es mucho, la medición no sirve. */
  deltaPitch: number
  /** Inclinación ABSOLUTA del eje óptico. La cuenta solo vale cerca del ecuador. */
  pitch: number
  /** Ladeo del teléfono. Con ladeo, el corrimiento deja de ser horizontal. */
  roll: number
}): number | null {
  const { anterior, actual, width, height, deltaYaw, deltaPitch, pitch, roll } = params

  // Muy chico: el corrimiento se confunde con el ruido y con el subpíxel.
  // Muy grande: la perspectiva rompe la suposición de que solo hubo un
  // desplazamiento. Cambiando de altura: el corrimiento ya no es solo horizontal.
  if (Math.abs(deltaYaw) < 3 || Math.abs(deltaYaw) > 20) return null
  if (Math.abs(deltaPitch) > 4) return null

  /* ── Los dos sesgos que tenía esta cuenta, y cómo se atacan ───────────────
   *
   * PRIMERO, el geométrico. El teléfono gira alrededor de la vertical del
   * MUNDO, no alrededor de su propio eje vertical. Con el aparato apuntando
   * arriba, ese giro mueve la imagen menos de lo que dice el giroscopio, y si
   * además está ladeado, lo poco que la mueve ya no es del todo horizontal. El
   * corrimiento real es f·tan(Δyaw·cos(pitch))·cos(roll), no f·tan(Δyaw), y la
   * versión vieja lo pasaba por alto: con el lente de 66° de la simulación
   * devolvía 71° a 35° de inclinación y 74° si encima iba ladeado. Siempre de
   * más y siempre en el mismo sentido, así que la mediana de varias
   * estimaciones no lo cancelaba; lo promediaba.
   *
   * SEGUNDO, el de la banda de correlación, que la fórmula NO arregla. Al
   * girar, cada columna de la imagen se corre una cantidad distinta —eso es la
   * perspectiva— y la correlación devuelve el promedio de todas, mientras que
   * la distancia focal se lee del centro. Con la imagen entera la cuenta se
   * quedaba corta: 61° a 65° para un lente de 66°.
   *
   * Y lo peor: los dos sesgos van en sentidos contrarios. En la versión vieja
   * se tapaban a medias y de forma impredecible —a 20° de inclinación el error
   * casi desaparecía por casualidad— así que corregir solo uno EMPEORA algunos
   * casos. Por eso aquí se atacan los dos a la vez:
   *
   *   · el geométrico, con la fórmula corregida de abajo;
   *   · el de la banda, midiendo solo el 40 % central de columnas, donde la
   *     perspectiva todavía no estiró nada apreciable.
   *
   * Encima se descartan las tomas que no estén cerca del ecuador. No es por la
   * fórmula, que ya está corregida: es porque fuera del ecuador la imagen
   * además SE GIRA y se deforma entre toma y toma, y la correlación solo sabe
   * buscar corrimientos horizontales, así que se agarra de un pico equivocado.
   * Al ecuador llega gratis: el usuario empieza siempre por el anillo del
   * horizonte, que es donde más tomas hay.
   *
   * Con las tres cosas juntas, la simulación sobre una panorámica sintética de
   * 96×72 con un lente de 66° da entre 64.3° y 67.5° en todo el rango de giro
   * aceptado, con correlaciones de 0.52 para arriba. */
  if (Math.abs(pitch) > PITCH_MAXIMO || Math.abs(roll) > ROLL_MAXIMO) return null

  // Lo que el giro REALMENTE barre delante del lente. Si de tanto descontar se
  // queda por debajo del mínimo útil, la medición vuelve a ser ruido.
  const giroEfectivo = Math.abs(deltaYaw) * Math.cos(pitch * DEG)
  if (giroEfectivo < 3) return null

  const { pixeles, confianza } = desplazamientoHorizontal(
    anterior,
    actual,
    width,
    height,
    Math.floor(width * 0.45),
    VENTANA_CALIBRACION,
  )
  if (confianza < CONFIANZA_MINIMA || Math.abs(pixeles) < 1) return null

  // Un giro a la derecha mueve la imagen a la izquierda: los signos se cancelan.
  const focal = Math.abs(pixeles) / (Math.tan(giroEfectivo * DEG) * Math.cos(roll * DEG))
  const hfov = (2 * Math.atan(width / (2 * focal))) / DEG

  // Ningún teléfono tiene una cámara fuera de este rango; si la cuenta sale de
  // ahí, la correlación se equivocó de pico. El rango va holgado a propósito:
  // recortarlo justo donde empiezan los lentes reales haría que un lente que sí
  // existe se rechazara por medio grado de error de medición.
  if (hfov < 34 || hfov > 110) return null
  return hfov
}

/**
 * ============================================================================
 *  MEDIR EL GIRO CON LA IMAGEN, PARA CERRAR EL ANILLO
 * ============================================================================
 *
 * Es la cuenta de `estimarFovConGiro` al revés. Allá el giroscopio era la
 * referencia y el resultado era el lente; aquí el lente ya se conoce y lo que
 * se quiere saber es cuánto giró el teléfono DE VERDAD entre dos tomas:
 *
 *   Δyaw = atan( corrimiento_px / f )
 *
 * ── Para qué ────────────────────────────────────────────────────────────────
 *
 * El costurero confía al cien por ciento en la orientación que reportan los
 * sensores, que viene del evento `deviceorientation` RELATIVO. Se prefiere el
 * relativo por una buena razón (el magnetómetro brinca 5 a 10 grados junto a un
 * marco de acero, y eso partiría la panorámica por la mitad), pero el precio es
 * que el yaw se va a la deriva.
 *
 * En el centro de la panorámica esa deriva no se nota, porque cada toma se pega
 * junto a su vecina y el error entre vecinas es diminuto. Donde sí aparece es en
 * el CIERRE: la última foto de la vuelta se pega junto a la primera, y ahí la
 * deriva de los 360 grados enteros sale de golpe como una pared partida. Con
 * esta función se puede medir el error acumulado —la suma de los Δyaw medidos
 * de toda la vuelta tiene que dar 360— y repartirlo entre las tomas.
 *
 * ── Qué significa el signo ──────────────────────────────────────────────────
 *
 * Positivo = el teléfono giró a la DERECHA, que es el mismo sentido en el que
 * crece el yaw del proyecto (`anglesOf` en ./orientation.ts: yaw = atan2(x, −z),
 * y a la derecha del frente está +x). Un giro a la derecha corre el contenido de
 * la imagen hacia la izquierda, así que el corrimiento en píxeles sale con el
 * signo contrario al del ángulo; de ahí el menos de la fórmula.
 *
 * Esa cadena de signos es la única parte que no se puede comprobar sin un
 * teléfono: depende de que el fotograma no venga espejeado y de que el eje X de
 * la imagen apunte a la derecha del aparato. Por eso existe `esperado`: si se le
 * pasa lo que dice el giroscopio, la medición que no se parezca a él se descarta
 * en vez de aplicarse al revés. Con el signo invertido, TODAS las mediciones se
 * caerían por ahí y el costurero seguiría trabajando como hoy —peinado, pero
 * nunca partido.
 *
 * ── Por qué la franja central y no la imagen entera ─────────────────────────
 *
 * Al girar, cada columna se corre distinto (eso es la perspectiva) y la
 * correlación devuelve el promedio de todas, que es mayor que el corrimiento del
 * centro, que es el que cumple la fórmula. Con la imagen completa el mismo
 * lente de 66° medía entre 61° y 65° (ver el comentario de
 * `desplazamientoHorizontal`), o sea que el promedio se pasa como un 4 %: en un
 * giro de 30° serían más de 1° de error inventado por pareja, mucho más que la
 * deriva que se está tratando de corregir. Por eso se mide la misma franja
 * central del 40 % que usa la calibración.
 */

export type YawMedido = {
  /** Grados que giró el teléfono. Positivo = a la derecha. */
  grados: number
  /** Correlación del pico, −1…1. Quien llama puede exigir más que el mínimo. */
  confianza: number
}

export function deltaYawMedido(params: {
  anterior: Float32Array
  actual: Float32Array
  width: number
  height: number
  /** Distancia focal EN PÍXELES DE ESTA imagen reducida: width / (2·tan(hfov/2)). */
  focalPx: number
  /**
   * Lo que dice el giroscopio para esta pareja, si se sabe. No se usa para
   * calcular nada: solo para tirar la medición que se aleje demasiado, que es
   * la firma de una correlación enganchada a un pico falso.
   */
  esperado?: number | null
  /** Cuánto puede alejarse la medida del giroscopio. Más que esto, se descarta. */
  tolerancia?: number
  /** Inclinación del eje óptico. El giro del mundo barre menos delante del lente. */
  pitch?: number
  /** Ladeo del teléfono: con ladeo, el corrimiento deja de ser horizontal. */
  roll?: number
}): YawMedido | null {
  const { anterior, actual, width, height, focalPx } = params
  const pitch = params.pitch ?? 0
  const roll = params.roll ?? 0
  const tolerancia = params.tolerancia ?? 10

  if (!Number.isFinite(focalPx) || focalPx <= 0) return null
  // Fuera de este rango la corrección por inclinación divide entre un coseno
  // chiquito y multiplica el error de medición en vez de corregirlo. Las tomas
  // del anillo del horizonte, que son las que cierran la vuelta, están muy
  // dentro.
  if (Math.abs(pitch) > 60 || Math.abs(roll) > 45) return null

  const maximo = Math.floor(width * 0.45)
  if (maximo < 1) return null

  const { pixeles, confianza } = desplazamientoHorizontal(
    anterior,
    actual,
    width,
    height,
    maximo,
    VENTANA_CALIBRACION,
  )
  if (confianza < CONFIANZA_MINIMA) return null

  /* El pico pegado al borde de la búsqueda no es un pico: es el mejor de los
     corrimientos que se alcanzaron a probar, y el de verdad se quedó afuera.
     Pasa cuando dos tomas están más separadas de lo que el traslape permite
     medir, y devolverlo sería jurar que el giro fue exactamente el máximo. */
  if (Math.abs(pixeles) >= maximo - 1) return null

  // Al revés que en la calibración: allá se despejaba f, aquí el ángulo.
  const anguloEfectivo = Math.atan(-pixeles / (focalPx * Math.cos(roll * DEG))) / DEG
  const grados = anguloEfectivo / Math.cos(pitch * DEG)

  if (!Number.isFinite(grados)) return null

  const { esperado } = params
  if (typeof esperado === 'number' && Number.isFinite(esperado)) {
    if (Math.abs(grados - esperado) > tolerancia) return null
  }

  return { grados, confianza }
}

/** Promedio robusto de varias estimaciones: la mediana aguanta un dato loco. */
export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const orden = [...valores].sort((a, b) => a - b)
  const medio = Math.floor(orden.length / 2)
  return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2
}

/** Reduce un canvas a un ancho máximo conservando la proporción. */
export function reducir(fuente: HTMLCanvasElement | HTMLImageElement, anchoMaximo: number) {
  const width = 'naturalWidth' in fuente ? fuente.naturalWidth : fuente.width
  const height = 'naturalHeight' in fuente ? fuente.naturalHeight : fuente.height
  if (width <= anchoMaximo) return fuente

  const escala = anchoMaximo / width
  const canvas = crearLienzo(Math.round(width * escala), Math.round(height * escala))
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return fuente
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(fuente, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Miniatura para la barra de habitaciones. */
export async function miniatura(
  fuente: HTMLCanvasElement | HTMLImageElement,
  ancho = 320,
  calidad = 0.72,
): Promise<Blob> {
  const width = 'naturalWidth' in fuente ? fuente.naturalWidth : fuente.width
  const height = 'naturalHeight' in fuente ? fuente.naturalHeight : fuente.height
  const alto = Math.max(1, Math.round((ancho * height) / width))

  const canvas = crearLienzo(ancho, alto)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('No se pudo generar la miniatura.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(fuente, 0, 0, ancho, alto)

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', calidad),
  )
  if (!blob) throw new Error('No se pudo generar la miniatura.')
  return blob
}

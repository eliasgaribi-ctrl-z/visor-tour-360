import { DEG } from '../math'

/**
 * ============================================================================
 *  A DÓNDE HAY QUE APUNTAR
 * ============================================================================
 *
 * El plan de captura: la lista de direcciones que hay que fotografiar para
 * cubrir la esfera sin huecos.
 *
 * ── Por qué los anillos de arriba llevan MENOS fotos ───────────────────────
 *
 * A la altura del horizonte, dar la vuelta completa son 360° de recorrido. A
 * 45° de inclinación, la vuelta mide cos(45°) = 71 % de eso, y en el cenit se
 * reduce a un punto. Repartir la misma cantidad de fotos en todos los anillos
 * sería tomar el triple de las necesarias arriba y abajo. El paso horizontal se
 * divide entre cos(pitch) y el problema desaparece.
 *
 * ── Por qué el traslape es tan grande ──────────────────────────────────────
 *
 * Se avanza el 62 % del campo de visión, o sea que cada foto comparte casi
 * cuatro décimas con su vecina. Suena a desperdicio pero no lo es: el borde de
 * una foto es donde peor se comporta la lente y donde el desvanecido de la
 * costura reparte peso, así que ahí se necesita material de las dos. Con menos
 * traslape aparecen líneas en las uniones.
 */

export type PuntoGuia = {
  id: string
  yaw: number
  pitch: number
  /** El anillo al que pertenece, para agrupar los avisos de la interfaz. */
  anillo: number
}

export type PlanOpciones = {
  hfov: number
  vfov: number
  /**
   * 'esfera'   cubre todo, incluidos techo y piso (más fotos)
   * 'vuelta'   solo el anillo del horizonte: rápido, deja techo y piso vacíos
   */
  alcance?: 'esfera' | 'vuelta'
  /** Fracción del campo de visión que se avanza entre fotos. */
  avance?: number
}

/**
 * Alturas (pitch) de cada anillo de fotos.
 *
 * ── El hueco que nadie ve venir ────────────────────────────────────────────
 *
 * Lo natural es subir anillos de `vfov · avance` en `vfov · avance` hasta
 * llegar arriba y cerrar con una foto al cenit. Pero una foto al cenit NO cubre
 * un casquete: cubre un rectángulo. Alrededor del polo solo alcanza para todas
 * las direcciones hasta `min(hfov, vfov) / 2` grados de distancia; más allá,
 * cubre unas direcciones sí y otras no, según por dónde caiga la esquina.
 *
 * Si el anillo de más arriba no llega hasta ahí, queda una faja sin fotografiar
 * a unos 60° de altura, y no en toda la vuelta sino a pedazos, que es peor
 * porque se ve como manchas y no como un hueco.
 *
 * Así que el anillo más alto se coloca donde tenga que estar:
 *
 *     pitch_arriba + vfov/2  ≥  90 − min(hfov, vfov)/2
 *
 * y los anillos intermedios se reparten parejo hasta ahí, con el paso que haga
 * falta para no pasarse de `vfov · avance`.
 *
 * Verificado por muestreo de la esfera (720×360 direcciones, pesadas por el
 * coseno del pitch) sobre lentes de 30° a 100° en vertical y en horizontal.
 */
function anillos(
  hfov: number,
  vfov: number,
  avance: number,
  alcance: 'esfera' | 'vuelta',
): number[] {
  if (alcance === 'vuelta') return [0]

  const pasoMaximo = Math.max(12, vfov * avance)
  // Hasta dónde llega la foto del polo cubriendo TODAS las direcciones.
  const radioDelPolo = Math.min(hfov, vfov) / 2
  // Un poco de traslape, para que no empalmen justo en el borde.
  const margen = Math.max(4, vfov * 0.1)
  const necesario = Math.max(0, 90 - radioDelPolo - vfov / 2 + margen)

  const salida = [0]
  const cuantos = Math.ceil(necesario / pasoMaximo)
  if (cuantos > 0) {
    const paso = necesario / cuantos
    for (let k = 1; k <= cuantos; k++) salida.push(k * paso, -k * paso)
  }

  // Cenit y nadir: una sola foto cada uno cierra el agujero del polo.
  salida.push(90, -90)
  return salida
}

export function planDeCaptura(opciones: PlanOpciones): PuntoGuia[] {
  const { hfov, vfov, alcance = 'esfera', avance = 0.8 } = opciones
  const pasoBase = Math.max(8, hfov * avance)

  const puntos: PuntoGuia[] = []
  const listaAnillos = anillos(hfov, vfov, avance, alcance)

  listaAnillos.forEach((pitch, indice) => {
    if (Math.abs(pitch) >= 89.5) {
      puntos.push({ id: `p${indice}-0`, yaw: 0, pitch: pitch > 0 ? 90 : -90, anillo: indice })
      return
    }

    /* El paso crece al acercarse al polo, donde la vuelta es más corta. Pero
       el que manda no es el centro de la foto sino su ORILLA de abajo: ahí la
       vuelta todavía es larga y la foto abarca menos grados de yaw. Midiendo
       por el centro, entre foto y foto queda un triángulo sin cubrir en la
       parte baja del anillo. */
    const pitchCritico = Math.max(0, Math.abs(pitch) - vfov / 2)
    const paso = Math.min(120, pasoBase / Math.max(0.28, Math.cos(pitchCritico * DEG)))
    const cuantos = Math.max(3, Math.round(360 / paso))
    const pasoExacto = 360 / cuantos

    for (let i = 0; i < cuantos; i++) {
      // Los anillos se alternan medio paso para que las uniones no queden
      // alineadas en una columna vertical a lo largo de toda la panorámica.
      const desfase = indice % 2 === 0 ? 0 : pasoExacto / 2
      const yaw = ((i * pasoExacto + desfase + 180) % 360) - 180
      puntos.push({ id: `p${indice}-${i}`, yaw, pitch, anillo: indice })
    }
  })

  // Se ordena por anillo y luego por yaw: el usuario da una vuelta completa a
  // la altura de los ojos, luego una arriba, luego una abajo. Ir saltando entre
  // alturas marea y hace que se pierda la cuenta.
  return puntos
}

/** Distancia angular entre dos direcciones, en grados. */
export function separacion(
  yawA: number,
  pitchA: number,
  yawB: number,
  pitchB: number,
): number {
  const a1 = pitchA * DEG
  const a2 = pitchB * DEG
  const d = (yawA - yawB) * DEG
  const coseno = Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(d)
  return Math.acos(Math.max(-1, Math.min(1, coseno))) / DEG
}

/** El punto pendiente más cercano a donde apunta el teléfono ahora. */
export function puntoMasCercano(
  puntos: PuntoGuia[],
  hechos: ReadonlySet<string>,
  yaw: number,
  pitch: number,
): { punto: PuntoGuia; distancia: number } | null {
  let mejor: PuntoGuia | null = null
  let mejorDistancia = Infinity

  for (const punto of puntos) {
    if (hechos.has(punto.id)) continue
    const distancia = separacion(yaw, pitch, punto.yaw, punto.pitch)
    if (distancia < mejorDistancia) {
      mejorDistancia = distancia
      mejor = punto
    }
  }

  return mejor ? { punto: mejor, distancia: mejorDistancia } : null
}

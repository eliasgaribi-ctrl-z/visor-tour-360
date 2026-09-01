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
 * Se suben anillos de `vfov · avance` en vfov·avance hasta que el siguiente ya
 * se saldría por arriba, y se cierra con una foto al cenit y otra al nadir: un
 * anillo cerca del polo daría muchas fotos casi idénticas, y una sola apuntando
 * hacia arriba tapa el agujero completo.
 */
function anillos(vfov: number, avance: number, alcance: 'esfera' | 'vuelta'): number[] {
  if (alcance === 'vuelta') return [0]

  const paso = Math.max(15, vfov * avance)
  const salida = [0]

  for (let k = 1; k < 6; k++) {
    const pitch = k * paso
    // Si el borde superior de este anillo ya pasó del polo, sobra.
    if (pitch + vfov / 2 > 96) break
    salida.push(pitch, -pitch)
  }

  salida.push(90, -90)
  return salida
}

export function planDeCaptura(opciones: PlanOpciones): PuntoGuia[] {
  const { hfov, vfov, alcance = 'esfera', avance = 0.72 } = opciones
  const pasoBase = Math.max(8, hfov * avance)

  const puntos: PuntoGuia[] = []
  const listaAnillos = anillos(vfov, avance, alcance)

  listaAnillos.forEach((pitch, indice) => {
    if (Math.abs(pitch) >= 89.5) {
      puntos.push({ id: `p${indice}-0`, yaw: 0, pitch: pitch > 0 ? 90 : -90, anillo: indice })
      return
    }

    // El paso crece al acercarse al polo, donde la vuelta es más corta.
    const paso = Math.min(120, pasoBase / Math.max(0.28, Math.cos(pitch * DEG)))
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

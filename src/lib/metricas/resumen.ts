/**
 * ============================================================================
 *  EL RESUMEN DE LAS VISITAS, DE PAQUETES A NÚMEROS
 * ============================================================================
 *
 * Los paquetes que manda `metricas.ts` son eventos crudos por sesión. Esto los
 * convierte en lo que un agente quiere leer: cuántas visitas, qué cuartos, cuánto
 * tiempo en cada uno, qué puntos, en qué aparatos, y si algo falló.
 *
 * Vive aquí —`src/lib/metricas/`— y no en el Worker porque lo usan los dos: el
 * Worker para contestar `GET /api/m/<llave>` y la pantalla "Visitas" del editor
 * para pintarlo. Y porque así se prueba con Vitest sin levantar nada. No toca el
 * DOM ni nada de Cloudflare: es una función de datos a datos.
 *
 * ── Las reglas de la cuenta ────────────────────────────────────────────────
 *
 * · Una VISITA es una sesión (un id), no un paquete: una sesión larga manda
 *   varios paquetes y cuenta una vez.
 * · El tiempo en una habitación es desde su evento `escena` hasta el siguiente
 *   `escena` o el `fin` del paquete, topado a 10 minutos: una pestaña olvidada
 *   abierta no es una visita de dos horas a la cocina.
 * · Los paquetes de una sesión se ordenan por `inicio` y se encadenan: la
 *   última habitación del paquete N sigue abierta hasta el primer evento del
 *   N+1 si llega dentro del tope; si no, se cierra en su `fin`.
 */

export type EventoCrudo = {
  e: string
  t: number
  id?: string
  kind?: string
  que?: string
  aparato?: string
  tactil?: boolean
  ancho?: number
}

export type PaqueteCrudo = {
  v?: number
  s: string
  inicio: number
  eventos: EventoCrudo[]
}

export type Resumen = {
  /** Sesiones distintas. */
  visitas: number
  /** Visitas por día (AAAA-MM-DD), para la barra de los últimos días. */
  porDia: Record<string, number>
  /** Por habitación: cuántas sesiones entraron y segundos en total. */
  escenas: Record<string, { visitas: number; segundos: number }>
  /** Toques por punto. */
  puntos: Record<string, number>
  aparatos: { modestos: number; normales: number; tactiles: number }
  fallas: number
  /** Primer y último paquete, en ms. */
  desde: number | null
  hasta: number | null
}

/** Tope al tiempo en una habitación: una pestaña olvidada no es una visita larga. */
export const TOPE_ESTANCIA_MS = 10 * 60 * 1000

const diaDe = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Resume una lista de paquetes (en cualquier orden) en números.
 *
 * Tolera basura: un paquete sin `s` o sin `eventos` se ignora, un evento con
 * un tipo desconocido también. Lo que baja del bucket lo escribió un endpoint
 * público, así que se lee como entrada y no como algo de confianza.
 */
export function resumir(paquetes: PaqueteCrudo[]): Resumen {
  const resumen: Resumen = {
    visitas: 0,
    porDia: {},
    escenas: {},
    puntos: {},
    aparatos: { modestos: 0, normales: 0, tactiles: 0 },
    fallas: 0,
    desde: null,
    hasta: null,
  }

  /* Agrupar por sesión y ordenar sus paquetes por inicio. */
  const porSesion = new Map<string, PaqueteCrudo[]>()
  for (const p of paquetes) {
    if (!p || typeof p.s !== 'string' || !Array.isArray(p.eventos)) continue
    if (typeof p.inicio !== 'number' || !Number.isFinite(p.inicio)) continue
    const lista = porSesion.get(p.s) ?? []
    lista.push(p)
    porSesion.set(p.s, lista)
  }

  for (const [, lista] of porSesion) {
    lista.sort((a, b) => a.inicio - b.inicio)
    resumen.visitas++
    const inicio = lista[0].inicio
    resumen.porDia[diaDe(inicio)] = (resumen.porDia[diaDe(inicio)] ?? 0) + 1
    resumen.desde = resumen.desde === null ? inicio : Math.min(resumen.desde, inicio)

    /* Los eventos de toda la sesión en una sola línea de tiempo absoluta. */
    const linea: { abs: number; ev: EventoCrudo }[] = []
    for (const p of lista) {
      for (const ev of p.eventos) {
        if (!ev || typeof ev.t !== 'number' || !Number.isFinite(ev.t)) continue
        linea.push({ abs: p.inicio + ev.t, ev })
      }
    }
    linea.sort((a, b) => a.abs - b.abs)
    if (linea.length > 0) {
      const ultimo = linea[linea.length - 1].abs
      resumen.hasta = resumen.hasta === null ? ultimo : Math.max(resumen.hasta, ultimo)
    }

    const vistas = new Set<string>()
    let abierta: { id: string; desde: number } | null = null
    const cerrar = (hasta: number) => {
      if (!abierta) return
      const seg = Math.min(TOPE_ESTANCIA_MS, Math.max(0, hasta - abierta.desde)) / 1000
      const e = (resumen.escenas[abierta.id] ??= { visitas: 0, segundos: 0 })
      e.segundos += seg
      abierta = null
    }

    for (const { abs, ev } of linea) {
      switch (ev.e) {
        case 'abrir':
          if (ev.aparato === 'modesto') resumen.aparatos.modestos++
          else resumen.aparatos.normales++
          if (ev.tactil) resumen.aparatos.tactiles++
          break
        case 'escena': {
          if (typeof ev.id !== 'string') break
          cerrar(abs)
          if (!vistas.has(ev.id)) {
            vistas.add(ev.id)
            const e = (resumen.escenas[ev.id] ??= { visitas: 0, segundos: 0 })
            e.visitas++
          }
          abierta = { id: ev.id, desde: abs }
          break
        }
        case 'punto':
          if (typeof ev.id === 'string') resumen.puntos[ev.id] = (resumen.puntos[ev.id] ?? 0) + 1
          break
        case 'falla':
          resumen.fallas++
          break
        case 'fin':
          /* El `fin` de un paquete NO cierra el cuarto: es la marca de un
             vaciado (la pestaña se escondió, pasaron 30 s), no el final de la
             sesión. Si llega otro paquete, el cuarto siguió abierto hasta su
             primer evento; si no llega, el último `fin` es donde se cierra
             abajo. El tope de diez minutos acota la espera larga. */
          break
        default:
          break
      }
    }
    cerrar(linea.length > 0 ? linea[linea.length - 1].abs : inicio)
  }

  for (const e of Object.values(resumen.escenas)) e.segundos = Math.round(e.segundos)
  return resumen
}

/**
 * Cuántas visitas hubo en los últimos `dias` días contando desde `ahora`.
 *
 * Recibe `ahora` en vez de leer el reloj: así es una función pura que se prueba
 * con una fecha fija, y la hoja del editor la llama desde el manejador (no
 * durante el render, donde leer el reloj da resultados distintos cada vez).
 */
export function visitasRecientes(porDia: Record<string, number>, ahora: number, dias = 7): number {
  let total = 0
  for (let i = 0; i < dias; i++) total += porDia[diaDe(ahora - i * 86_400_000)] ?? 0
  return total
}

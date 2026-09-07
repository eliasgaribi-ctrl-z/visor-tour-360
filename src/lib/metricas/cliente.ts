/**
 * ============================================================================
 *  MÉTRICAS DE UNA CASA PUBLICADA: SESIONES, NO PERSONAS
 * ============================================================================
 *
 * Lo que un agente quiere saber de su link: cuántos lo abrieron, qué cuartos
 * les importaron y cuánto se quedaron en cada uno, qué puntos tocaron, y si a
 * alguien se le rompió. Es la gráfica que vende, y no necesita cuentas.
 *
 * ── Privacidad por diseño, no por aviso ────────────────────────────────────
 *
 * Sin cookies, sin nada en `localStorage`, sin huella del navegador, y el
 * Worker NO guarda la IP. El id de sesión es aleatorio y vive en
 * `sessionStorage`: muere con la pestaña. Se miden SESIONES, no personas, y
 * nadie es seguible entre recorridos ni entre días. Se respetan
 * `navigator.doNotTrack` y `globalPrivacyControl`: con cualquiera de los dos
 * encendidos, este módulo no manda nada.
 *
 * Eso es lo que quita la necesidad de un banner de consentimiento: no hay
 * identificador persistente ni retención de IP. Es una restricción de DISEÑO
 * —escrita aquí y en el Worker— y no un texto legal.
 *
 * ── Cómo llega al servidor ─────────────────────────────────────────────────
 *
 * `unload` NO dispara en Safari de iOS: usarlo perdería el 100 % de los datos
 * de iPhone, que es la mayoría del tráfico esperado. Se manda con
 * `sendBeacon()` en `visibilitychange → hidden` Y en `pagehide`, con bandera
 * anti-duplicado, más un vaciado cada 30 s para que una pestaña que el sistema
 * mata de golpe reporte casi todo. `sendBeacon` topa en 64 KB por página, así
 * que el búfer se acota a 200 eventos: una sesión larga manda varios paquetes
 * en vez de perder el envío completo en silencio.
 *
 * ── No-op cuando no hay a quién reportar ───────────────────────────────────
 *
 * Solo la casa PUBLICADA tiene métricas: `VisorPublicado` crea este objeto con
 * la llave. El visor local (`#/ver/<id>`, `#/demo`) no lo crea, así que el
 * agente revisando su propia casa no cuenta como visita y "Mis recorridos" no
 * paga ni un byte de este módulo (solo lo importa `VisorPublicado`).
 */

export type Metricas = {
  /** Se entró a una habitación (también la primera). */
  escena(id: string): void
  /** Se tocó un punto. */
  punto(id: string, kind: 'link' | 'info'): void
  /** No se pudo cargar una foto. */
  falla(que: string): void
  /** La sesión termina (el visor se desmonta): manda lo que quede y se apaga. */
  cerrar(): void
}

/** Un evento tal como viaja. `t` son milisegundos desde que se abrió la casa. */
type Evento =
  | { e: 'abrir'; t: number; aparato: 'modesto' | 'normal'; tactil: boolean; ancho: number }
  | { e: 'escena'; t: number; id: string }
  | { e: 'punto'; t: number; id: string; kind: 'link' | 'info' }
  | { e: 'falla'; t: number; que: string }
  | { e: 'fin'; t: number }

export type Paquete = { v: 1; s: string; inicio: number; eventos: Evento[] }

const TOPE_EVENTOS = 200
const CADA_MS = 30_000
const LLAVE_SESION = 'visor-tour-360:sesion'
const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789'

/** ¿La persona pidió que no se la siga? Se respeta sin preguntar dos veces. */
function pidioNoSeguir(): boolean {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string }
  return n.doNotTrack === '1' || n.globalPrivacyControl === true || n.msDoNotTrack === '1'
}

/** Un id de 60 bits de azar, que vive lo que viva la pestaña. */
function idDeSesion(): string {
  try {
    const previo = sessionStorage.getItem(LLAVE_SESION)
    if (previo && /^[a-z2-9]{12}$/.test(previo)) return previo
  } catch {
    /* sin sessionStorage: un id nuevo por carga, que sigue siendo una sesión */
  }
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  let id = ''
  for (const b of bytes) id += ALFABETO[b & 31]
  try {
    sessionStorage.setItem(LLAVE_SESION, id)
  } catch {
    /* igual: el id vive en memoria */
  }
  return id
}

export type OpcionesDeMetricas = {
  /** Dirección del Worker, sin barra final. */
  base: string
  /** La llave de la casa publicada. */
  llave: string
  /** Lo que `aparato()` dijo de este teléfono. */
  modesto: boolean
}

/**
 * Crea el reportero de una casa publicada, o `null` si no debe reportar nada
 * (la persona pidió no ser seguida, o el navegador no puede mandar en segundo
 * plano). Quien llama trata `null` igual que un objeto: `metricas?.escena(id)`.
 */
export function crearMetricas({ base, llave, modesto }: OpcionesDeMetricas): Metricas | null {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return null
  if (pidioNoSeguir()) return null
  if (typeof navigator.sendBeacon !== 'function') return null

  const destino = `${base}/api/m/${llave}`
  const sesion = idDeSesion()
  const inicio = Date.now()
  const ahora = () => Date.now() - inicio
  let eventos: Evento[] = [
    {
      e: 'abrir',
      t: 0,
      aparato: modesto ? 'modesto' : 'normal',
      tactil: navigator.maxTouchPoints > 0,
      // Redondeado a la centena: es para saber si es teléfono o escritorio, no
      // para reconocer a nadie.
      ancho: Math.round(window.innerWidth / 100) * 100,
    },
  ]
  let cerrado = false
  /* Contra el doble envío: `visibilitychange` y `pagehide` suelen llegar los
     dos al cerrar la pestaña, con milisegundos de diferencia. */
  let pendiente = false

  const mandar = () => {
    if (!pendiente || eventos.length === 0) return
    pendiente = false
    const paquete: Paquete = { v: 1, s: sesion, inicio, eventos: [...eventos, { e: 'fin', t: ahora() }] }
    eventos = []
    /* `text/plain` a propósito: con `application/json` el navegador pide
       permiso (preflight) antes de mandar, y en un `pagehide` ya no hay tiempo
       para dos viajes. El Worker lo lee como JSON igual. */
    navigator.sendBeacon(destino, new Blob([JSON.stringify(paquete)], { type: 'text/plain' }))
  }

  const anotar = (evento: Evento) => {
    if (cerrado) return
    eventos.push(evento)
    pendiente = true
    if (eventos.length >= TOPE_EVENTOS) mandar()
  }

  const alEsconderse = () => {
    if (document.visibilityState === 'hidden') mandar()
  }
  document.addEventListener('visibilitychange', alEsconderse)
  window.addEventListener('pagehide', mandar)
  const cada = window.setInterval(mandar, CADA_MS)
  // El primer paquete (el `abrir`) sale con la primera escena o al esconderse.
  pendiente = true

  return {
    escena: (id) => anotar({ e: 'escena', t: ahora(), id: id.slice(0, 64) }),
    punto: (id, kind) => anotar({ e: 'punto', t: ahora(), id: id.slice(0, 64), kind }),
    falla: (que) => anotar({ e: 'falla', t: ahora(), que: que.slice(0, 120) }),
    cerrar: () => {
      if (cerrado) return
      mandar()
      cerrado = true
      document.removeEventListener('visibilitychange', alEsconderse)
      window.removeEventListener('pagehide', mandar)
      window.clearInterval(cada)
    },
  }
}

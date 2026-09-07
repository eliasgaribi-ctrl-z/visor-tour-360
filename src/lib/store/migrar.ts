import type { Ficha, Hotspot, Marca, PosicionEnPlano } from '../types'
import type { MarcaGuardada, SceneOrigin } from './types'
import { clamp, wrap360 } from '../math'
import { revisarPaleta } from '../contraste'
import { limpiarPosicion } from '../planta'

/**
 * ============================================================================
 *  MIGRACIÓN Y NORMALIZACIÓN
 * ============================================================================
 *
 * Dos trabajos parecidos que conviene no confundir:
 *
 *   migrarRecorrido()   ·  un manifiesto que viene de un ARCHIVO `.tour`, y que
 *                          pudo escribirlo una versión vieja del visor — o
 *                          editarlo alguien a mano.
 *   normalizarTour()    ·  un registro que sale de IndexedDB, escrito por una
 *                          versión anterior de ESTA misma app.
 *
 * ── Por qué hace falta el segundo, que es el que no existía ────────────────
 *
 * `importarTour` ya toleraba lo viejo, pero con `??` dispersos en cada campo. Lo
 * que nadie cubría es que **los registros de IndexedDB no se re-validan nunca**:
 * `getTour()` devolvía lo que hubiera en la base, tal cual. Un `StoredTour`
 * escrito hoy y leído por el código de mañana llega con los campos nuevos
 * ausentes directo a los componentes, y el fallo aparece lejos de la causa — un
 * `undefined.length` dentro de un render, meses después.
 *
 * Con `normalizarTour()` dentro de `getTour()` hay UN punto de entrada para
 * todos sus consumidores, y el defaulting deja de estar repartido.
 *
 * ── La regla del formato publicado, para cuando llegue ─────────────────────
 *
 * Los campos son ADITIVOS y nunca se borran ni se reutilizan. Un campo
 * desconocido se ignora. Eso es lo que permite que un visor cacheado de la
 * semana pasada abra un recorrido nuevo sin romperse: verá menos, no verá mal.
 */

/** Un color solo se acepta si es un hex que cualquier navegador entiende. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function texto(v: unknown, max = 200): string | undefined {
  if (typeof v !== 'string') return undefined
  const limpio = v.trim().slice(0, max)
  return limpio || undefined
}

/**
 * Un número que pudo llegar como texto.
 *
 * `"90"` se acepta y vale 90, a propósito: un manifiesto editado a mano que dice
 * `"initialYaw": "90"` está diciendo noventa con toda claridad, y rechazarlo
 * tiraría el dato para no ganar nada. Lo que NO se acepta es `"90 grados"` ni
 * `""` ni `true` — de ahí la comprobación de finitud, que es la que atrapa los
 * `NaN` que produce `Number()` con cualquier basura.
 */
function numero(v: unknown): number | undefined {
  const n = typeof v === 'string' ? (v.trim() === '' ? NaN : Number(v)) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

function entero(v: unknown, max = 99): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  const n = Math.round(v)
  return n >= 0 && n <= max ? n : undefined
}

function color(v: unknown): string | undefined {
  return typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : undefined
}

/**
 * Limpia una marca que viene de fuera.
 *
 * Se filtra campo por campo en vez de confiar en el objeto entero, y no por
 * paranoia: estos valores acaban dentro de un `style.setProperty()`, así que un
 * string arbitrario es una inyección de CSS. Un hex validado no lo es.
 */
export function limpiarMarca(crudo: unknown): MarcaGuardada | undefined {
  if (!crudo || typeof crudo !== 'object') return undefined
  const m = crudo as Record<string, unknown>
  const colores = (m.colores ?? {}) as Record<string, unknown>

  const limpia: MarcaGuardada = {}
  const nombre = texto(m.nombre, 60)
  if (nombre) limpia.nombre = nombre

  const paleta: NonNullable<Marca['colores']> = {}
  for (const clave of ['brand300', 'brand400', 'brand500', 'brand600', 'ink50', 'ink200', 'ink700', 'ink900'] as const) {
    const c = color(colores[clave])
    if (c) paleta[clave] = c
  }
  const hud = color(m.hudFondo)
  const hudTinta = color(m.hudTinta)
  const hudTintaSuave = color(m.hudTintaSuave)
  const fondo = color(m.fondoApp)

  /* ── Que un hex válido no baste ──────────────────────────────────────────
   *
   * Hasta aquí el filtro solo preguntaba "¿es un color que el navegador
   * entiende?", y `#111111` lo es. Medido midiendo los píxeles del navegador:
   * un `.tour` con `"ink50": "#111111"` deja la portada a **1.05 de contraste**
   * —texto casi negro sobre el fondo casi negro de la app, o sea invisible— y no
   * hace falta mala fe: una inmobiliaria que llene "ink" pensando "tinta =
   * oscuro" produce eso exacto.
   *
   * `revisarPaleta` mide cada tinta contra cada superficie con el umbral que le
   * toca (4.5 para letras, 3 para formas grandes) y devuelve los pares que no
   * llegan. Si hay uno, se descarta la PALETA COMPLETA y no el token culpable:
   * mezclar media marca con medio tema base da un resultado peor que cualquiera
   * de los dos —el respaldo casi blanco de `ink50` sobre un `fondoApp` claro de
   * marca es justo eso—, y sin paleta el visor se ve como se ve hoy, que es
   * legible por construcción. Un tema claro coherente pasa entero.
   *
   * El nombre, la tipografía y el logo sobreviven: no pintan nada encima de
   * nada. */
  if (
    revisarPaleta({ colores: paleta, hudFondo: hud, hudTinta, hudTintaSuave, fondoApp: fondo })
      .length === 0
  ) {
    if (Object.keys(paleta).length > 0) limpia.colores = paleta
    if (hud) limpia.hudFondo = hud
    if (hudTinta) limpia.hudTinta = hudTinta
    if (hudTintaSuave) limpia.hudTintaSuave = hudTintaSuave
    if (fondo) limpia.fondoApp = fondo
  }

  if (m.tipografia === 'sistema' || m.tipografia === 'serif' || m.tipografia === 'geometrica') {
    limpia.tipografia = m.tipografia
  }
  /* `logoId` NO se copia, y es deliberado: es una llave del IndexedDB del
     aparato que exportó. Traerla al recorrido importado deja un puntero a un
     blob que en ESTE teléfono no existe — ni logo ni error, solo un hueco que
     nadie sabe explicar. El logo cruza como archivo dentro del ZIP
     (`marca/logo.png`), y quien lo guarda de nuevo es `importarTour`, con una
     llave local recién hecha. Un campo ausente es honesto; una llave muerta no. */

  return Object.keys(limpia).length > 0 ? limpia : undefined
}

/** Limpia una ficha que viene de fuera. Todo texto se acota. */
export function limpiarFicha(crudo: unknown): Ficha | undefined {
  if (!crudo || typeof crudo !== 'object') return undefined
  const f = crudo as Record<string, unknown>
  const agenteCrudo = (f.agente ?? {}) as Record<string, unknown>

  const ficha: Ficha = {}
  const precio = texto(f.precio, 40)
  if (precio) ficha.precio = precio
  const superficie = texto(f.superficie, 40)
  if (superficie) ficha.superficie = superficie
  const recamaras = entero(f.recamaras, 20)
  if (recamaras !== undefined) ficha.recamaras = recamaras
  const banos = entero(f.banos, 20)
  if (banos !== undefined) ficha.banos = banos
  const direccion = texto(f.direccion, 160)
  if (direccion) ficha.direccion = direccion
  const descripcion = texto(f.descripcion, 600)
  if (descripcion) ficha.descripcion = descripcion

  /* ── Los tres datos de contacto se sanean AQUÍ, y no es cosmético ─────────
   *
   * La portada los interpola dentro de `href`: `https://wa.me/${whatsapp}`,
   * `tel:${telefono}`, `mailto:${correo}`. Y el `.tour` llega por WhatsApp de un
   * tercero y se abre en el teléfono de un COMPRADOR, que no eligió confiar en
   * nadie. Con solo `trim` y truncado, un archivo preparado a mano metía:
   *
   *   correo: "cliente@casa.mx?subject=Confirma%20tus%20datos&bcc=espia@mal.mx"
   *
   * y el comprador toca "Correo" y su cliente de correo abre un mensaje con un
   * BCC que él no puso. Comprobado metiendo un `.tour` por el camino real del
   * importador y leyendo el `href` del DOM.
   *
   * Con `telefono` es lo mismo: una cadena MMI/USSD en un `tel:` puede hacer que
   * el marcador ejecute un código de operadora en vez de llamar.
   *
   * Así que cada uno se acota a los caracteres que su esquema necesita y nada
   * más. No es una lista negra de lo peligroso —esas siempre se quedan cortas—
   * sino una lista blanca de lo que un número de teléfono o un correo pueden
   * tener. */
  const agente: NonNullable<Ficha['agente']> = {}
  const nombre = texto(agenteCrudo.nombre, 80)
  if (nombre) agente.nombre = nombre

  /* Un número para marcar: dígitos, y los signos que de verdad aparecen escritos
     en un teléfono. Fuera queda todo lo que da significado a una cadena MMI:
     `*`, `#`, `,`, `;` y `p`/`w` (pausa y espera). */
  const telefono = texto(agenteCrudo.telefono, 30)?.replace(/[^0-9+\-() ]/g, '').trim()
  if (telefono && /\d/.test(telefono)) agente.telefono = telefono

  // Solo dígitos: es lo que espera el enlace de wa.me.
  const whatsapp = texto(agenteCrudo.whatsapp, 20)?.replace(/\D/g, '')
  if (whatsapp) agente.whatsapp = whatsapp

  /* Una sola dirección y nada más. El `?` es la puerta de los encabezados de
     `mailto:` (subject, cc, bcc, body), así que se exige la forma de un correo
     completa y se rechaza cualquier cosa que traiga otro carácter. */
  const correo = texto(agenteCrudo.correo, 120)?.trim()
  if (correo && /^[^\s@,;:<>()[\]\\"?&#/]+@[^\s@,;:<>()[\]\\"?&#/]+\.[a-z]{2,}$/i.test(correo)) {
    agente.correo = correo
  }

  if (Object.keys(agente).length > 0) ficha.agente = agente

  return Object.keys(ficha).length > 0 ? ficha : undefined
}

/**
 * Una habitación tal como sale del manifiesto, ya con la forma que espera el
 * resto del importador: sin campos ausentes y sin nada que no sea del tipo que
 * dice ser.
 */
export type EscenaLimpia = {
  id: string
  name: string
  archivo: string
  miniatura?: string
  initialYaw: number
  hotspots: Hotspot[]
  origin?: SceneOrigin
  coverageDeg?: number
  rumbo?: number
  nivel?: { tiltX: number; tiltZ: number }
  /** Desde la v3: dónde está en el plano de la casa. */
  plano?: PosicionEnPlano
  createdAt: number
}

/** Un punto del manifiesto. Devuelve `undefined` si no se puede salvar. */
function limpiarPunto(crudo: unknown): Hotspot | undefined {
  if (!crudo || typeof crudo !== 'object') return undefined
  const h = crudo as Record<string, unknown>

  const id = texto(h.id, 60)
  const yaw = numero(h.yaw)
  const pitch = numero(h.pitch)
  /* Sin id no se puede usar como llave de React, y sin dirección no se puede
     colocar en la esfera. Los tres son la identidad del punto: si falta uno, no
     hay punto que arreglar. */
  if (!id || yaw === undefined || pitch === undefined) return undefined

  const base = {
    id,
    label: texto(h.label, 80) ?? '',
    yaw: wrap360(yaw),
    // El mismo ±85 que documenta `src/lib/types.ts`: en el polo la proyección
    // se degenera y el marcador se va al infinito.
    pitch: clamp(pitch, -85, 85),
  }

  if (h.kind === 'link') {
    const to = texto(h.to, 60)
    if (!to) return undefined
    const arriveYaw = numero(h.arriveYaw)
    return arriveYaw === undefined
      ? { ...base, kind: 'link', to }
      : { ...base, kind: 'link', to, arriveYaw: wrap360(arriveYaw) }
  }
  if (h.kind === 'info') {
    const body = texto(h.body, 600)
    return body ? { ...base, kind: 'info', body } : { ...base, kind: 'info' }
  }
  // Un `kind` que no es ninguno de los dos no se puede dibujar de ninguna forma.
  return undefined
}

/**
 * Limpia una habitación que viene de un archivo.
 *
 * ── Por qué existe, que es la parte que hay que recordar ──────────────────
 *
 * `marca` y `ficha` se filtraban campo por campo desde el primer día, y los
 * campos numéricos de la escena entraban TAL CUAL, dos líneas más abajo. Un
 * manifiesto con `"initialYaw": "90"` se guardaba como string, sobrevivía a las
 * recargas —IndexedDB guarda strings igual de bien que números— y el fallo
 * aparecía lejos de la causa: en el rig, `'90' + 0` no es 90 sino `'900'`, así
 * que la habitación abría mirando a un ángulo que no existe.
 *
 * Es el mismo tipo de agujero que el de los `href` de la portada, y por el mismo
 * motivo: un `.tour` llega por WhatsApp de un tercero. La diferencia es que este
 * no se ve, y por eso duró más.
 *
 * ── Y por qué está aquí y no en `normalizar.ts` ───────────────────────────
 *
 * Por peso, y está medido: `normalizar.ts` lo llama `getTour()`, o sea la
 * pantalla "Mis recorridos", así que todo lo que viva ahí entra en el chunk de
 * arranque. `migrar.ts` solo lo carga el importador. Esta es la frontera por
 * donde un valor mal tipado puede ENTRAR; los registros que ya estén mal dentro
 * de la base necesitan la estampa de versión que todavía no existe.
 *
 * Devuelve `undefined` cuando no hay nada que importar (sin nombre de archivo no
 * hay foto que buscar en el ZIP).
 */
export function limpiarEscena(crudo: unknown): EscenaLimpia | undefined {
  if (!crudo || typeof crudo !== 'object') return undefined
  const e = crudo as Record<string, unknown>

  const archivo = texto(e.archivo, 255)
  if (!archivo) return undefined

  const escena: EscenaLimpia = {
    id: texto(e.id, 60) ?? '',
    name: texto(e.name, 80) ?? 'Habitación',
    archivo,
    initialYaw: wrap360(numero(e.initialYaw) ?? 0),
    hotspots: (Array.isArray(e.hotspots) ? e.hotspots : [])
      .map(limpiarPunto)
      .filter((h): h is Hotspot => h !== undefined),
    createdAt: numero(e.createdAt) ?? Date.now(),
  }

  const miniatura = texto(e.miniatura, 255)
  if (miniatura) escena.miniatura = miniatura
  if (e.origin === 'captura' || e.origin === 'foto') escena.origin = e.origin

  /* Cobertura: 0 grados no es una foto y más de 360 no es una esfera. Fuera de
     ese rango se omite en vez de corregirse, porque el aviso de "foto parcial"
     que la UI pinta con este número es peor si el número está inventado. */
  const cobertura = numero(e.coverageDeg)
  if (cobertura !== undefined && cobertura > 0 && cobertura <= 360) {
    escena.coverageDeg = cobertura
  }

  /* El rumbo se normaliza al círculo en vez de rechazarse fuera de rango: 400 y
     40 son el mismo rumbo, y un archivo escrito a mano con grados acumulados
     dice algo perfectamente válido. Lo que no se acepta es algo que no sea un
     número, porque entonces la brújula diría "N" apuntando a cualquier lado —y
     un `undefined` la hace decir "frente", que es la verdad. */
  const rumbo = numero(e.rumbo)
  if (rumbo !== undefined) escena.rumbo = wrap360(rumbo)

  /* El nivel se acota en vez de rechazarse: ±15° es el rango del control, y un
     valor fuera de él no es un nivel, es otra foto. Se guarda solo si los DOS
     ejes son números; un nivel a medias no significa nada. Y cero en los dos es
     lo mismo que ninguno, así que no se guarda. */
  if (e.nivel && typeof e.nivel === 'object') {
    const n = e.nivel as Record<string, unknown>
    const tiltX = numero(n.tiltX)
    const tiltZ = numero(n.tiltZ)
    if (tiltX !== undefined && tiltZ !== undefined) {
      const x = clamp(tiltX, -15, 15)
      const z = clamp(tiltZ, -15, 15)
      if (x !== 0 || z !== 0) escena.nivel = { tiltX: x, tiltZ: z }
    }
  }

  /* La posición en el plano se acota a la imagen y el giro al círculo; sin las
     dos coordenadas no hay posición. Ver `limpiarPosicion` en ../planta.ts. */
  const posicion = limpiarPosicion(e.plano)
  if (posicion) escena.plano = posicion

  /* Una fecha de creación que no es una fecha se cambia por ahora, no por cero:
     el listado ordena por ella, y un cero manda la habitación al año 1970. */
  if (escena.createdAt <= 0) escena.createdAt = Date.now()

  return escena
}

/**
 * La escalera de versiones del manifiesto, un peldaño por función.
 *
 * Explícita y no un montón de `??` sueltos: cuando llegue la v3 se agrega
 * `de2a3` y se ve de un golpe qué cambió en cada salto. Con el defaulting
 * disperso, el tercer salto es donde se rompe.
 */
function de1a2(recorrido: Record<string, unknown>): Record<string, unknown> {
  // v1 no tenía marca ni ficha, y las dos son opcionales: no hay nada que
  // rellenar. El peldaño existe igual, para que el salto quede documentado y
  // para tener dónde poner lo que sí haga falta la próxima vez.
  return recorrido
}

function de2a3(recorrido: Record<string, unknown>): Record<string, unknown> {
  // v3 agrega `plano` al recorrido y a cada habitación, los dos opcionales: un
  // archivo v2 simplemente no trae plano, y eso ya lo entiende el resto del
  // importador. El peldaño queda escrito por la misma razón que el anterior.
  return recorrido
}

/**
 * Deja el `recorrido` de un manifiesto en la forma de la versión actual.
 *
 * Se llama UNA vez, justo después de validar el formato y la versión, para que
 * de ahí en adelante el resto de `importarTour` solo vea la forma de hoy.
 */
export function migrarRecorrido(
  recorrido: Record<string, unknown>,
  version: number,
): Record<string, unknown> {
  let actual = recorrido
  if (version < 2) actual = de1a2(actual)
  if (version < 3) actual = de2a3(actual)
  return actual
}


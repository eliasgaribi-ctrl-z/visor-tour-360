/**
 * ============================================================================
 *  CONTRASTE: QUE UNA MARCA NO PUEDA DEJAR EL VISOR ILEGIBLE
 * ============================================================================
 *
 * Vive aparte de `marca.ts` por la misma razón que `math.ts` vive aparte de
 * `math3d.ts`: esto es matemática de color, no identidad visual, y lo necesitan
 * dos capas que no se conocen entre sí —el filtro del importador de `.tour`
 * (`limpiarMarca`) y quien aplica la marca al DOM—. Con cero dependencias, así
 * que entrar en el chunk de arranque cuesta lo que pesa el archivo y nada más.
 *
 * ── Qué defiende esto ─────────────────────────────────────────────────────
 *
 * Un `.tour` con `"ink50": "#111111"` deja la portada entera a **1.01 de
 * contraste** (medido): texto casi negro sobre el fondo casi negro de la app. No
 * hace falta mala fe para llegar ahí — una inmobiliaria que llene "ink" pensando
 * "tinta = oscuro" produce exactamente eso, y el archivo se abre en el teléfono
 * de un comprador que no eligió confiar en nadie.
 *
 * ── El límite honesto, que hay que decir y no esconder ────────────────────
 *
 * El vidrio del HUD es `rgba(12,16,22,.72)` SOBRE LA FOTO. O sea que el fondo
 * real de ese texto es la panorámica, y cambia con cada habitación y con cada
 * píxel: nadie lo puede validar de antemano. Aquí se mide contra `#0c1016`, que
 * es el vidrio como si fuera opaco, y eso es el lado OPTIMISTA para un texto
 * claro (con una foto brillante detrás, el contraste real es menor).
 *
 * Así que esta comprobación no certifica el HUD. Lo que hace es cazar el caso
 * catastrófico —dos colores casi iguales— que es el que convierte "personalizable"
 * en "roto". Para el resto está el `drop-shadow` que el HUD ya usa sobre la foto.
 */

/** "#e19100" o "#e91" → [225, 145, 0]. */
function canales(hex: string): [number, number, number] | null {
  const limpio = hex.trim().replace(/^#/, '')
  const largo = limpio.length === 3 ? 1 : limpio.length === 6 ? 2 : 0
  if (!largo || !/^[0-9a-f]+$/i.test(limpio)) return null
  const leer = (i: number) => {
    const trozo = limpio.slice(i * largo, i * largo + largo)
    return parseInt(largo === 1 ? trozo + trozo : trozo, 16)
  }
  return [leer(0), leer(1), leer(2)]
}

/**
 * Luminancia relativa según WCAG 2.
 *
 * No es el promedio de los canales ni el brillo del HSL: el ojo humano ve el
 * verde muchísimo más que el azul, y esos coeficientes (0.2126 / 0.7152 / 0.0722)
 * son justamente esa diferencia. Con un promedio, un azul saturado pasaría por
 * "claro" y el texto negro encima quedaría ilegible.
 */
function luminancia(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const n = c / 255
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Razón de contraste WCAG entre dos colores: de 1 (igual) a 21 (negro/blanco).
 *
 * Un color que no se entiende devuelve 1, o sea "no se ve": es el valor que hace
 * que quien pregunte lo rechace, y es la respuesta correcta para un dato que
 * llegó de un archivo ajeno.
 */
export function contraste(a: string, b: string): number {
  const ca = canales(a)
  const cb = canales(b)
  if (!ca || !cb) return 1
  const la = luminancia(ca)
  const lb = luminancia(cb)
  const [claro, oscuro] = la > lb ? [la, lb] : [lb, la]
  return (claro + 0.05) / (oscuro + 0.05)
}

/** Negro o blanco: el que se lea mejor encima de `fondo`. */
export function tintaPara(fondo: string): '#000000' | '#ffffff' {
  return contraste(fondo, '#000000') >= contraste(fondo, '#ffffff') ? '#000000' : '#ffffff'
}

/**
 * Los dos umbrales de WCAG, y por qué son dos.
 *
 * `CONTRASTE_MINIMO = 3` es el de WCAG 1.4.11, para componentes de interfaz y
 * gráficos: el aro del joystick, el aro de un marcador, el relleno de un botón.
 * Son formas grandes, y exigirles 4.5 dejaría fuera marcas perfectamente
 * legibles.
 *
 * `CONTRASTE_TEXTO = 4.5` es el de WCAG 1.4.3 para texto normal, y es el que
 * aplica a los grises que de verdad son letras: el precio de la casa, la
 * dirección, el nombre de la habitación.
 */
export const CONTRASTE_MINIMO = 3
export const CONTRASTE_TEXTO = 4.5

/** ¿Este color de acento se ve sobre el vidrio del HUD? */
export function contrasteOk(acento: string, fondoHud = '#0c1016'): boolean {
  return contraste(acento, fondoHud) >= CONTRASTE_MINIMO
}

/**
 * El tema que trae el visor. Es el respaldo de cada token que la marca no pise.
 *
 * ⚠️ Estos valores son una COPIA de los del `@theme` de `src/index.css`, y una
 * copia se desincroniza. Por eso `tools/pruebas/contraste.mjs` lee el CSS de
 * verdad y compara uno por uno: si alguien cambia el tema y no cambia esto, la
 * prueba se pone roja en vez de dejar que la validación mida contra colores que
 * ya no existen.
 *
 * `hudFondo` es la excepción declarada: en el CSS es `rgba(12,16,22,.72)`, que no
 * es un hex y no se puede medir. Aquí va su versión opaca, con el límite que el
 * encabezado de este archivo explica.
 *
 * `hudTinta` y `hudTintaSuave` son la otra excepción: en el CSS no son un hex
 * sino `var(--color-ink-50)` y `var(--color-ink-200)` —la tinta del HUD SIGUE a
 * la de la app hasta que una marca diga otra cosa—, así que aquí van los mismos
 * valores que `ink50` e `ink200`, y la prueba exige que el CSS diga eso.
 */
export const TEMA_BASE = {
  brand300: '#eec474',
  brand400: '#ebae42',
  brand500: '#e19100',
  brand600: '#c07100',
  ink50: '#f8f8f8',
  ink200: '#d2d4d7',
  ink700: '#2f3339',
  ink900: '#0c1016',
  fondoApp: '#0b0f19',
  hudFondo: '#0c1016',
  hudTinta: '#f8f8f8',
  hudTintaSuave: '#d2d4d7',
} as const

type Clave = keyof typeof TEMA_BASE

/** Las tres cosas que pueden quedar DETRÁS del texto. */
const SUPERFICIES = ['fondoApp', 'hudFondo', 'ink900'] as const
/**
 * Los tokens que salen como letras, y SOBRE QUÉ. `ink50`/`ink200` colorean la
 * página (el body, la portada, las pantallas); `hudTinta`/`hudTintaSuave`
 * colorean lo que va encima del vidrio. Medir `ink50` contra el vidrio cuando
 * la marca trae su propia tinta de HUD rechazaría justo el caso para el que
 * existe la tinta propia: un vidrio claro sobre una app oscura.
 *
 * `brand300` va con el HUD y no con la página, y salió de grepear: en el visor
 * —que es donde se aplica una marca— solo se pinta como texto encima del vidrio
 * (el icono del giroscopio encendido, la píldora del editor de puntos). Medirlo
 * también contra la página exigiría un color que se lea 4.5:1 sobre casi negro Y
 * sobre blanco a la vez, que casi no existe, y haría imposible el vidrio claro.
 */
const TEXTOS_APP: readonly Clave[] = ['ink50', 'ink200']
const TEXTOS_HUD: readonly Clave[] = ['hudTinta', 'hudTintaSuave', 'brand300']
/** Los que salen como relleno o borde de algo grande, en los dos sitios. */
const GRAFICOS: readonly Clave[] = ['brand400', 'brand500']

export type ParteDeMarca = {
  colores?: Record<string, string | undefined>
  hudFondo?: string
  hudTinta?: string
  hudTintaSuave?: string
  fondoApp?: string
}

/** Por qué se rechazó una paleta. Vacío = está bien. */
export type Ilegible = { tinta: string; superficie: string; razon: number; pedido: number }

/**
 * ¿Esta paleta se puede leer?
 *
 * Se valida **como conjunto y no token por token**, y esa es la decisión que
 * importa. Un token malo no se puede descartar solo: si se cae `ink50` y se
 * queda el `fondoApp` claro de la marca, el respaldo casi blanco del tema aterriza
 * sobre un fondo casi blanco y el resultado es *peor* que la paleta original. Una
 * mezcla a medias de dos temas coherentes no es coherente.
 *
 * Así que o entra completa o no entra ninguna, y sin paleta el visor se ve como
 * se ve hoy — que es legible por construcción.
 *
 * Un tema claro de verdad (fondo claro, vidrio claro, tintas oscuras) pasa sin
 * problema: lo que no pasa es medio tema.
 *
 * ── Los dos tokens que NO se miden contra el fondo, y por qué ────────────
 *
 * `ink700` es el punto APAGADO del joystick, y su 1.50 contra el vidrio es
 * deliberado: un indicador de "off" que contrasta es un indicador que no dice
 * nada.
 *
 * `brand600` es el estado PRESIONADO del botón de acento (`active:bg-brand-600`),
 * no un color en reposo. Que sea apenas distinto del fondo es normal —lo que
 * importa de un estado pulsado es que se distinga del que no lo está— y medirlo
 * contra la página rechazaba paletas buenas: el violeta 600/700 de Tailwind, que
 * es de los más usados, se caía por 2.78. Lo que sí se le mide es que la tinta
 * del botón —la que `aplicarMarca` deriva de `brand500`— siga leyéndose cuando el
 * fondo cambia a `brand600` al apretarlo, porque la tinta no cambia con él.
 */
export function revisarPaleta(marca: ParteDeMarca): Ilegible[] {
  const efectivo = (clave: Clave): string => {
    if (clave === 'hudFondo') return marca.hudFondo ?? TEMA_BASE.hudFondo
    if (clave === 'fondoApp') return marca.fondoApp ?? TEMA_BASE.fondoApp
    /* La tinta del HUD sigue a la de la app mientras la marca no diga otra
       cosa: es lo que hace el CSS (`--color-hud: var(--color-ink-50)`), y la
       revisión tiene que medir lo que se va a PINTAR, no lo que dice el tema. */
    if (clave === 'hudTinta') return marca.hudTinta ?? efectivo('ink50')
    if (clave === 'hudTintaSuave') return marca.hudTintaSuave ?? efectivo('ink200')
    return marca.colores?.[clave] ?? TEMA_BASE[clave]
  }

  const fallos: Ilegible[] = []
  for (const superficie of SUPERFICIES) {
    const fondo = efectivo(superficie)
    const textos = superficie === 'hudFondo' ? TEXTOS_HUD : TEXTOS_APP
    for (const [tokens, pedido] of [
      [textos, CONTRASTE_TEXTO],
      [GRAFICOS, CONTRASTE_MINIMO],
    ] as const) {
      for (const token of tokens) {
        const razon = contraste(efectivo(token), fondo)
        if (razon < pedido) fallos.push({ tinta: token, superficie, razon, pedido })
      }
    }
  }

  /* El botón de acento: su texto sale de `tintaPara(brand500)` y no cambia al
     apretarlo, así que tiene que leerse sobre los dos fondos. */
  const acento = efectivo('brand500')
  const tinta = tintaPara(acento)
  for (const estado of ['brand500', 'brand600'] as const) {
    const razon = contraste(tinta, efectivo(estado))
    if (razon < CONTRASTE_TEXTO) {
      fallos.push({ tinta: `tinta del botón (${tinta})`, superficie: estado, razon, pedido: CONTRASTE_TEXTO })
    }
  }

  return fallos
}

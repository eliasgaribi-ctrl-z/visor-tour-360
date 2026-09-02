import type { Marca } from './types'
import { tintaPara } from './contraste'

/**
 * ============================================================================
 *  VESTIR EL VISOR CON LA MARCA DE OTRA INMOBILIARIA
 * ============================================================================
 *
 * Sin recompilar nada, y eso no es un truco: es cómo funciona Tailwind v4.
 *
 * El tema vive en el `@theme` de `src/index.css`, que se emite como propiedades
 * personalizadas en `:root`, y —comprobado en el CSS ya compilado— las utilidades
 * las consumen POR REFERENCIA:
 *
 *     .bg-brand-500 { background-color: var(--color-brand-500) }
 *
 * El hexadecimal aparece solo en la declaración. Así que reasignar la propiedad
 * en `:root` retiñe los ~40 usos repartidos en 17 archivos de una sola vez, y no
 * hay que tocar ni un `className`.
 *
 * Las propiedades personalizadas existen desde Safari 9.1, muy por debajo del
 * piso de Safari 13 del proyecto. Y `aplanarCapas` de `vite.config.ts` ya deja el
 * bundle sin un solo `@layer`, así que tampoco hay trampa de precedencia.
 *
 * ── La letra chica, que sí existe ──────────────────────────────────────────
 *
 * Las utilidades con ALFA queman el color. `bg-brand-500/10` compila a dos
 * reglas: un `rgba(225,145,0,.1)` de respaldo y un `color-mix(...)`. En Safari
 * 16.2 y arriba gana el `color-mix` y sigue el token; en un iPhone más viejo se
 * queda el ámbar de THIQA pase lo que pase.
 *
 * Hay 16 en el repo, pero solo tres las ve un comprador y de esas dos eran de
 * marca: el aro del joystick y el aro de los marcadores. Esas dos se cambiaron a
 * utilidad plana con `opacity-*`, que sí sigue el token en cualquier Safari. Las
 * trece restantes están en pantallas del editor, que solo ve el agente.
 */

/** Las pilas de fuentes que se pueden elegir. */
const TIPOGRAFIAS: Record<NonNullable<Marca['tipografia']>, string> = {
  sistema:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  geometrica: '"Avenir Next", Avenir, "Century Gothic", ui-sans-serif, system-ui, sans-serif',
}

/**
 * Una LISTA BLANCA y no una URL de fuente, a propósito. Una URL arbitraria haría
 * que el visor de un comprador pidiera un archivo a un tercero —un problema de
 * privacidad que el cliente no eligió— y bloquearía el primer pintado. Las
 * fuentes propias, cuando hagan falta, se auto-hospedan en `public/` y se
 * alcanzan con `asset()`.
 */
export const TIPOGRAFIAS_DISPONIBLES = Object.keys(TIPOGRAFIAS) as NonNullable<
  Marca['tipografia']
>[]

/** Qué propiedad de CSS le toca a cada color de la marca. */
const PROPIEDAD: Record<string, string> = {
  brand300: '--color-brand-300',
  brand400: '--color-brand-400',
  brand500: '--color-brand-500',
  brand600: '--color-brand-600',
  ink50: '--color-ink-50',
  ink200: '--color-ink-200',
  ink700: '--color-ink-700',
  ink900: '--color-ink-900',
}

/** Todo lo que esta función puede llegar a escribir, para poder limpiarlo. */
const TODAS = [...Object.values(PROPIEDAD), '--hud-fondo', '--fondo-app', '--tipografia', '--tinta-marca']

/**
 * Aplica una marca, o la quita si no hay ninguna.
 *
 * Siempre limpia antes de escribir: sin eso, salir de un recorrido de marca
 * ajena y entrar a otro sin marca dejaría los colores del anterior pegados. Es
 * el tipo de fallo que solo se ve navegando de verdad entre dos recorridos, o
 * sea nunca durante el desarrollo.
 */
export function aplicarMarca(marca: Marca | undefined): void {
  if (typeof document === 'undefined') return
  const raiz = document.documentElement.style
  for (const propiedad of TODAS) raiz.removeProperty(propiedad)
  if (!marca) return

  for (const [clave, valor] of Object.entries(marca.colores ?? {})) {
    const propiedad = PROPIEDAD[clave]
    if (propiedad && valor) raiz.setProperty(propiedad, valor)
  }

  if (marca.hudFondo) raiz.setProperty('--hud-fondo', marca.hudFondo)
  if (marca.fondoApp) raiz.setProperty('--fondo-app', marca.fondoApp)
  if (marca.tipografia) raiz.setProperty('--tipografia', TIPOGRAFIAS[marca.tipografia])

  /* La tinta que va ENCIMA del color de acento. Los botones principales usan
     `text-black` porque el ámbar de THIQA es claro; con un azul marino de marca,
     ese texto negro desaparece. Se deriva del color en vez de dejarlo a que
     alguien se acuerde. */
  if (marca.colores?.brand500) {
    raiz.setProperty('--tinta-marca', tintaPara(marca.colores.brand500))
  }
}

/* ------------------------------------------------------------------ CONTRASTE */

/**
 * La matemática de color se mudó a `./contraste`: la necesitan dos capas que no
 * se conocen —el filtro del importador de `.tour` y esta— y tenerla aquí metía
 * todo `marca.ts` en el chunk de arranque por una función de veinte líneas.
 *
 * Se reexporta desde aquí para no romper a quien ya la importaba de este módulo.
 */
export {
  CONTRASTE_MINIMO,
  CONTRASTE_TEXTO,
  contraste,
  contrasteOk,
  revisarPaleta,
  tintaPara,
} from './contraste'

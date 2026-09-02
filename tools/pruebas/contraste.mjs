/**
 * ============================================================================
 *  LA CUENTA DEL CONTRASTE
 * ============================================================================
 *
 *   node tools/pruebas/contraste.mjs
 *
 * `src/lib/contraste.ts` decide si el color que sube una inmobiliaria se puede
 * leer encima del vidrio del HUD. De esa cuenta depende que el visor siga siendo
 * usable con una marca ajena: si la luminancia estuviera mal, el editor de marca
 * aprobaría colores ilegibles y nadie se enteraría hasta ver un visor roto en el
 * teléfono de un comprador.
 *
 * La tentación es promediar los canales, o usar el brillo del HSL. Está mal: el
 * ojo humano ve el verde muchísimo más que el azul, y por eso WCAG pesa
 * 0.2126 / 0.7152 / 0.0722. Con un promedio, un azul saturado pasaría por
 * "claro" y el texto negro encima quedaría invisible.
 *
 * Así que no se comprueba contra la intuición: se comprueba contra razones de
 * contraste PUBLICADAS. Solo van las que se pueden citar; una expectativa
 * inventada a ojo no es una referencia y no prueba nada. (La primera versión de
 * esta prueba traía un valor estimado a mano para el ámbar de THIQA y "fallaba"
 * mientras el algoritmo estaba bien.)
 *
 * Corre sin navegador: va en el job rápido del CI.
 */

/*
 * ── EL ERROR QUE ESTA PRUEBA COMETIÓ, Y QUE NO SE DEBE REPETIR ────────────
 *
 * La primera versión reimplementaba aquí `canales`, `luminancia`, `contraste` y
 * `tintaPara`, y probaba ESA reimplementación: `src/lib/marca.ts` no se tocaba.
 * Se demostró cambiando la `luminancia` de producción por el promedio de canales
 * —el error exacto que este encabezado nombra— y las catorce aserciones pasaron
 * en verde, exit 0. Con ese promedio, `contrasteOk` aprobaría acentos ilegibles y
 * el CI no diría nada.
 *
 * Peor: la copia ya había DIVERGIDO de la real. La `canales` de producción valida
 * el hex y devuelve null —y entonces `contraste` devuelve 1—, la del arnés no
 * validaba nada, así que ese camino no se probaba en ninguna parte. Ahora sí.
 *
 * Se importan las funciones REALES, con `--experimental-strip-types`. Misma
 * regla que aprendió damp.mjs: un arnés que reimplementa lo que prueba no prueba
 * nada.
 */
import { readFileSync } from 'node:fs'

import {
  contraste,
  contrasteOk,
  revisarPaleta,
  TEMA_BASE,
  tintaPara as tintaReal,
} from '../../src/lib/contraste.ts'

/** El arnés habla de "negro"/"blanco"; la función devuelve el hex. */
const tintaPara = (fondo) => (tintaReal(fondo) === '#000000' ? 'negro' : 'blanco')

/** Razones de contraste publicadas. Cada una es citable, no estimada. */
const REFERENCIAS = [
  ['#000000', '#ffffff', 21, 'el máximo posible'],
  ['#ffffff', '#ffffff', 1, 'el mínimo posible'],
  ['#777777', '#ffffff', 4.48, 'el gris que apenas pasa AA'],
  ['#0000ff', '#ffffff', 8.59, 'azul puro sobre blanco'],
  ['#808080', '#000000', 5.32, 'el gris medio sobre negro'],
]

/**
 * Y el comportamiento que de verdad se usa: elegir la tinta que va ENCIMA del
 * color de acento. Los botones principales llevan texto negro porque el ámbar de
 * THIQA es claro; con un azul marino de marca, ese negro desaparece.
 */
const TINTAS = [
  ['#e19100', 'negro', 'el ámbar de THIQA'],
  ['#14213d', 'blanco', 'un azul marino'],
  ['#ffe066', 'negro', 'un amarillo claro'],
  ['#000000', 'blanco', 'negro'],
  ['#ffffff', 'negro', 'blanco'],
]

let bien = true

console.log('=== Razón de contraste contra referencias publicadas ===')
for (const [a, b, esperado, que] of REFERENCIAS) {
  const r = contraste(a, b)
  const ok = Math.abs(r - esperado) < 0.05
  console.log(`  ${a} / ${b}   ${r.toFixed(2).padStart(5)}  esperado ${String(esperado).padEnd(5)} ${ok ? 'ok' : 'MAL'}   ${que}`)
  if (!ok) bien = false
}

console.log('\n=== La tinta que se lee encima del acento ===')
for (const [fondo, esperado, que] of TINTAS) {
  const t = tintaPara(fondo)
  const ok = t === esperado
  console.log(`  ${fondo}   ${t.padEnd(7)} esperado ${esperado.padEnd(7)} ${ok ? 'ok' : 'MAL'}   ${que}`)
  if (!ok) bien = false
}

/* El umbral del proyecto es 3:1 y no el 4.5:1 de WCAG para texto, a propósito:
   lo que se pinta con el acento son elementos GRANDES —el aro del joystick, el
   aro de un marcador, el relleno de un botón— y para eso WCAG 1.4.11 pide 3:1.
   Exigir 4.5 dejaría fuera marcas perfectamente legibles. */
const VIDRIO = '#0c1016'
console.log(`\n=== Sobre el vidrio del HUD (${VIDRIO}), umbral 3:1 ===`)
for (const [color, deberia] of [
  ['#e19100', true], // el de hoy
  ['#ffffff', true],
  ['#14213d', false], // azul marino: se pierde en el vidrio oscuro
  ['#0c1016', false], // el vidrio consigo mismo
]) {
  const r = contraste(color, VIDRIO)
  const pasa = r >= 3
  const ok = pasa === deberia
  console.log(`  ${color}   ${r.toFixed(2).padStart(5)}  ${(pasa ? 'pasa' : 'no pasa').padEnd(8)} ${ok ? 'ok' : 'MAL'}`)
  if (!ok) bien = false
}

/* ── El camino que la copia divergente del arnés NO probaba ───────────────
 *
 * La `canales` de producción valida el hex y devuelve null para lo que no lo sea;
 * entonces `contraste` devuelve 1 y `contrasteOk` dice que no pasa. Ese
 * comportamiento importa: es lo que impide que un color basura de un `.tour`
 * ajeno se cuele como "aprobado". La reimplementación que vivía aquí no validaba
 * nada, así que este camino no se probaba en ninguna parte. */
console.log('\n=== Entradas que no son hex ===')
for (const malo of ['navy', 'rgb(11,29,81)', '#0b1d51ff', '#12345', '', 'var(--x)']) {
  const r = contraste(malo, '#ffffff')
  /* 1 es el valor de "no pude leer esto", y es el correcto: cualquier otro
     numero seria una aprobacion inventada. */
  const ok = r === 1 && contrasteOk(malo) === false
  console.log(`  ${(malo || '(vacío)').padEnd(16)} contraste ${r.toFixed(2)}  ${ok ? 'se rechaza · ok' : 'MAL'}`)
  if (!ok) bien = false
}

/* ==========================================================================
 * EL TEMA BASE, CONTRA EL CSS DE VERDAD
 *
 * `TEMA_BASE` es una COPIA de los valores del `@theme` de `src/index.css`, y una
 * copia se desincroniza: alguien cambia el ámbar por un azul, la validación
 * sigue midiendo contra el ámbar, y aprueba paletas que en pantalla no se leen.
 * Así que se compara con el archivo, no con la memoria.
 *
 * `hudFondo` es la única excepción y está declarada: en el CSS es
 * `rgba(12,16,22,.55)` —el vidrio, que no es un hex— y en `TEMA_BASE` va su
 * versión opaca. Se comprueba que sean el MISMO color, no el mismo texto.
 * ========================================================================== */
console.log('\n=== El tema base no se desincronizó del CSS ===')
const css = readFileSync('src/index.css', 'utf8')
const tema = css.slice(css.indexOf('@theme'), css.indexOf('@layer base'))

for (const [clave, valor] of Object.entries(TEMA_BASE)) {
  let enCss
  let como
  if (clave === 'hudFondo') {
    // `background-color: var(--hud-fondo, rgba(12, 16, 22, 0.55))`
    const m = /--hud-fondo,\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(css)
    enCss = m ? '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('') : null
    como = 'el vidrio, sin su alfa'
  } else if (clave === 'fondoApp') {
    // `background: var(--fondo-app, #0b0f19)`
    const m = /--fondo-app,\s*(#[0-9a-f]{3,8})/i.exec(css)
    enCss = m ? m[1] : null
    como = 'el respaldo del body'
  } else {
    const propiedad = clave.replace(/^(brand|ink)/, '$1-').replace(/(\d)/, '$1')
    const m = new RegExp(`--color-${propiedad}:\\s*(#[0-9a-f]{3,6})`, 'i').exec(tema)
    enCss = m ? m[1] : null
    como = '@theme'
  }
  const ok = enCss !== null && enCss.toLowerCase() === valor.toLowerCase()
  console.log(`  ${clave.padEnd(10)} ${valor}  css ${String(enCss).padEnd(9)} ${ok ? 'ok' : 'MAL'}   ${como}`)
  if (!ok) bien = false
}

/* ==========================================================================
 * LA PALETA COMPLETA
 *
 * `revisarPaleta` es lo que impide que un `.tour` ajeno deje el visor ilegible.
 * Se valida como CONJUNTO: o entra completa o no entra ninguna, porque media
 * marca mezclada con medio tema base da algo peor que cualquiera de los dos.
 * ========================================================================== */
console.log('\n=== Paletas que entran y paletas que no ===')
const PALETAS = [
  ['el tema base, sin marca', {}, true],
  [
    'un violeta coherente',
    { colores: { brand300: '#c4b5fd', brand500: '#7c3aed', brand600: '#6d28d9' }, hudFondo: '#101827', fondoApp: '#0a0a12' },
    true,
  ],
  [
    'un tema CLARO coherente',
    {
      colores: { ink50: '#1e1b4b', ink200: '#4c1d95', brand300: '#5b21b6', brand400: '#6d28d9', brand500: '#5b21b6', brand600: '#4c1d95', ink900: '#f5f3ff' },
      hudFondo: '#ffffff',
      fondoApp: '#f5f3ff',
    },
    true,
  ],
  ['"tinta = oscuro": el caso medido', { colores: { ink50: '#111111' } }, false],
  ['solo el fondo claro, sin tintas', { fondoApp: '#f5f3ff' }, false],
  ['vidrio blanco con tintas de hoy', { hudFondo: '#ffffff' }, false],
  ['todo del mismo color', { colores: { ink50: '#808080', ink200: '#808080' }, fondoApp: '#808080', hudFondo: '#808080' }, false],
]
for (const [que, marca, deberia] of PALETAS) {
  const fallos = revisarPaleta(marca)
  const ok = (fallos.length === 0) === deberia
  const detalle = fallos.length
    ? fallos.map((f) => `${f.tinta}/${f.superficie} ${f.razon.toFixed(2)}`).slice(0, 2).join(' · ')
    : ''
  console.log(`  ${que.padEnd(34)} ${(fallos.length === 0 ? 'entra' : 'se rechaza').padEnd(11)} ${ok ? 'ok' : 'MAL'}   ${detalle}`)
  if (!ok) bien = false
}

/* Y los dos tokens que NO se miden contra el fondo, a propósito. Si alguien los
   agrega a la revisión "por completitud", estas dos líneas se ponen rojas: los
   dos están por debajo de 3:1 contra el vidrio Y eso es lo correcto.

   Cada uno va con el resto de su paleta y no solo, porque la revisión es de
   conjunto: `brand600` suelto SÍ se rechaza —y con razón— porque la tinta que
   `aplicarMarca` deriva del `brand500` que quedó del tema base no se lee encima
   de un violeta. Lo que se afirma aquí es más preciso: dentro de una paleta
   coherente, su 2.68 contra el vidrio no lo descalifica. */
console.log('\n=== Los dos que quedan fuera de la revisión del fondo ===')
for (const [clave, valor, paleta, razon] of [
  ['ink700', TEMA_BASE.ink700, { ink700: TEMA_BASE.ink700 }, 'el punto APAGADO del joystick: 1.50 es deliberado'],
  ['brand600', '#6d28d9', { brand500: '#7c3aed', brand600: '#6d28d9' }, 'el estado PRESIONADO, no un color en reposo'],
]) {
  const r = contraste(valor, TEMA_BASE.hudFondo)
  const fallos = revisarPaleta({ colores: paleta })
  const ok = fallos.length === 0 && r < 3
  console.log(
    `  ${clave.padEnd(10)} ${valor}  contra el vidrio ${r.toFixed(2)}  ${ok ? 'entra · ok' : 'MAL'}   ${razon}`,
  )
  if (!ok) bien = false
}

console.log(`\n${bien ? 'LA CUENTA ES CORRECTA' : 'HAY ALGO MAL'}`)
process.exit(bien ? 0 : 1)

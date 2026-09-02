/**
 * ============================================================================
 *  LA CUENTA DEL CONTRASTE
 * ============================================================================
 *
 *   node tools/pruebas/contraste.mjs
 *
 * `src/lib/marca.ts` decide si el color que sube una inmobiliaria se puede leer
 * encima del vidrio del HUD. De esa cuenta depende que el visor siga siendo
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

/* La copia de las funciones de src/lib/marca.ts, escrita aquí a mano y no
   importada, por lo mismo que en damp.mjs: importarla obligaría a compilar
   TypeScript solo para esto, y la prueba dejaría de ser independiente. */
function canales(hex) {
  const limpio = hex.trim().replace(/^#/, '')
  const largo = limpio.length === 3 ? 1 : 2
  const leer = (i) => {
    const trozo = limpio.slice(i * largo, i * largo + largo)
    return parseInt(largo === 1 ? trozo + trozo : trozo, 16)
  }
  return [leer(0), leer(1), leer(2)]
}

function luminancia(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const n = c / 255
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a, b) {
  const la = luminancia(canales(a))
  const lb = luminancia(canales(b))
  const [claro, oscuro] = la > lb ? [la, lb] : [lb, la]
  return (claro + 0.05) / (oscuro + 0.05)
}

const tintaPara = (fondo) =>
  contraste(fondo, '#000000') >= contraste(fondo, '#ffffff') ? 'negro' : 'blanco'

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

console.log(`\n${bien ? 'LA CUENTA ES CORRECTA' : 'HAY ALGO MAL'}`)
process.exit(bien ? 0 : 1)

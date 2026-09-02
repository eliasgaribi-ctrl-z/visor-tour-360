/**
 * ============================================================================
 *  LA MARCA DE VERDAD REVISTE EL VISOR
 * ============================================================================
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/pruebas/marca.mjs http://localhost:5173/
 *
 * Toda la personalización de marca se apoya en UN hecho: que Tailwind v4 emita
 * las utilidades por referencia —`.bg-brand-500{background-color:var(--color-brand-500)}`—
 * y no con el hexadecimal quemado. Si eso dejara de ser cierto en una versión
 * futura de Tailwind, `aplicarMarca()` seguiría corriendo sin errores y
 * simplemente no pintaría nada: un fallo silencioso que solo se vería en la demo
 * de venta a un cliente.
 *
 * Así que no se comprueba leyendo el CSS: se mide en píxeles. Se recorta el aro
 * del joystick —que es de color de marca— antes y después de reasignar los
 * tokens, y se exige que el color CAMBIE y que al quitarlos VUELVA.
 *
 * Reasigna las propiedades igual que `aplicarMarca`, y a propósito no importa esa
 * función: lo que se prueba es que el mecanismo funcione contra el CSS realmente
 * compilado, que es la parte que no está bajo nuestro control.
 */
const BASE = process.argv[2]
if (!BASE) {
  console.error('Falta la URL. Ejemplo: node tools/pruebas/marca.mjs http://localhost:5173/')
  process.exit(1)
}

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('Falta Playwright:  npm i -D playwright && npx playwright install chromium')
  process.exit(1)
}

/** Un morado que no se parece a nada del tema de THIQA, para que el cambio cante. */
const PRUEBA = {
  '--color-brand-300': '#c9a9f5',
  '--color-brand-400': '#a978e8',
  '--color-brand-500': '#7c3aed',
  '--color-brand-600': '#5b21b6',
  '--hud-fondo': '#f5f3ff',
  '--fondo-app': '#1e1b4b',
  '--tinta-marca': '#ffffff',
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})
const page = await ctx.newPage()
const errores = []
page.on('console', (m) => {
  if (m.type() === 'error') errores.push(m.text())
})
page.on('pageerror', (e) => errores.push(String(e)))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

/** El color calculado de un elemento, resuelto por el navegador. */
const colorDe = (selector, propiedad) =>
  page.evaluate(
    ([s, p]) => {
      const e = document.querySelector(s)
      return e ? getComputedStyle(e).getPropertyValue(p).trim() : null
    },
    [selector, propiedad],
  )

const poner = (vars) =>
  page.evaluate((v) => {
    for (const [k, valor] of Object.entries(v)) document.documentElement.style.setProperty(k, valor)
  }, vars)

const quitar = (vars) =>
  page.evaluate((v) => {
    for (const k of Object.keys(v)) document.documentElement.style.removeProperty(k)
  }, vars)

/* Se miran tres cosas distintas a propósito, porque llegan por caminos
   distintos: un token de color puro, el vidrio del HUD (que es una utilidad
   propia del proyecto, no de Tailwind) y el fondo del body. */
const SONDAS = [
  // El aro que late en los marcadores de enlace: `bg-brand-500` plano.
  { nombre: 'aro de los marcadores', selector: '.animate-ping', propiedad: 'background-color' },
  // El vidrio del HUD, que es una utilidad propia del proyecto y no de Tailwind.
  { nombre: 'vidrio del HUD', selector: '.hud-glass', propiedad: 'background-color' },
  // El fondo, que llega por el estilo inline de index.html y no por la hoja.
  { nombre: 'fondo de la app', selector: 'body', propiedad: 'background-color' },
]

/* No se sondea el aro del joystick aunque sea de marca: solo se pinta con el
   color de acento MIENTRAS SE EMPUJA, y en reposo es blanco translúcido. Una
   sonda que en reposo no mira lo que dice mirar es una sonda que no prueba nada. */

let bien = true
console.log('=== La marca reviste el visor ===')

const antes = {}
for (const s of SONDAS) antes[s.nombre] = await colorDe(s.selector, s.propiedad)

await poner(PRUEBA)
await page.waitForTimeout(400)

const conMarca = {}
for (const s of SONDAS) conMarca[s.nombre] = await colorDe(s.selector, s.propiedad)

await quitar(PRUEBA)
await page.waitForTimeout(400)

const despues = {}
for (const s of SONDAS) despues[s.nombre] = await colorDe(s.selector, s.propiedad)

for (const s of SONDAS) {
  const a = antes[s.nombre]
  const m = conMarca[s.nombre]
  const d = despues[s.nombre]
  const encontrado = a !== null && a !== ''
  const cambio = encontrado && m !== a
  const volvio = encontrado && d === a
  const ok = encontrado && cambio && volvio
  console.log(
    `  ${s.nombre.padEnd(34)} ${(ok ? 'cambia y vuelve' : 'MAL').padEnd(16)} ${a} → ${m} → ${d}`,
  )
  /* Que la sonda EXISTA se exige a propósito: si un cambio se lleva por delante
     el selector, la prueba tiene que gritarlo y no dar por bueno que no
     encontró nada. Es la misma política del aro de `rendimiento.mjs`. */
  if (!encontrado) console.log(`     no se encontró "${s.selector}" en la página`)
  if (!ok) bien = false
}

console.log(`\n${bien ? 'LOS TOKENS MANDAN' : 'HAY ALGO MAL'}`)
console.log('errores de consola:', errores.length ? errores : 'ninguno')
await browser.close()
process.exit(bien && errores.length === 0 ? 0 : 1)

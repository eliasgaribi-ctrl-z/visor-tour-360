/**
 * ============================================================================
 *  ¿SE PUEDE TOCAR TODO CON EL PULGAR?
 * ============================================================================
 *
 * Recorre las pantallas en un iPhone SE simulado —la más chica que sigue siendo
 * común: si algo cabe ahí, cabe en todas— y revisa dos cosas de cada control:
 *
 *   · que mida al menos 44 px de lado, que es el mínimo que recomienda Apple
 *     (Android pide 48). Debajo de eso, el pulgar falla y la gente toca dos
 *     veces o toca lo de junto.
 *   · que la pantalla no se desborde a lo ancho, que en un celular se siente
 *     como que la app "se salió".
 *
 * ── Cómo se corre ──────────────────────────────────────────────────────────
 *
 *   npm run dev                                   (en otra terminal)
 *   npm i -D playwright && npx playwright install chromium
 *   node tools/pruebas/tactil.mjs http://localhost:5173/
 */

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('Falta Playwright:\n  npm i -D playwright && npx playwright install chromium')
  process.exit(1)
}

const BASE = process.argv[2]
if (!BASE) {
  console.error('Uso: node tools/pruebas/tactil.mjs <url del visor>')
  process.exit(1)
}

const MINIMO = 44

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const ctx = await browser.newContext({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})
const page = await ctx.newPage()
const errores = []
page.on('pageerror', (e) => errores.push(e.message))

let bien = true

const auditar = async (nombre) => {
  const r = await page.evaluate((minimo) => {
    const chicos = []
    let total = 0
    for (const el of document.querySelectorAll('button, a, input, select, textarea, [role=application]')) {
      const est = getComputedStyle(el)
      if (est.display === 'none' || est.visibility === 'hidden' || est.opacity === '0') continue
      const c = el.getBoundingClientRect()
      if (c.width === 0 || c.height === 0) continue
      total++
      if (c.height < minimo || c.width < minimo) {
        const texto = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24)
        chicos.push(`${texto} (${Math.round(c.width)}×${Math.round(c.height)})`)
      }
    }
    return {
      total,
      chicos,
      desbordaX: document.documentElement.scrollWidth > innerWidth + 1,
    }
  }, MINIMO)

  const problema = r.chicos.length > 0 || r.desbordaX
  if (problema) bien = false
  console.log(
    `  ${nombre.padEnd(24)} ${String(r.total).padStart(2)} controles · ` +
      (r.chicos.length ? `CHICOS: ${r.chicos.join(', ')}` : `todos ≥ ${MINIMO} px`) +
      (r.desbordaX ? ' · DESBORDA A LO ANCHO' : ''),
  )
}

console.log(`=== Tamaño de lo que se toca · iPhone SE (375×667) · mínimo ${MINIMO} px ===`)

await page.goto(BASE + '#/demo', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
await auditar('visor')

await page.goto(BASE + '#/inicio', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await auditar('mis recorridos')
await page.getByRole('button', { name: 'Nuevo recorrido' }).click()
await page.waitForTimeout(400)
await auditar('hoja: recorrido nuevo')
await page.getByPlaceholder('Casa en Tlajomulco').fill('Prueba táctil')
await page.getByRole('button', { name: 'Crear', exact: true }).click()
await page.waitForTimeout(700)
await auditar('editor vacío')
await page.getByRole('button', { name: 'Agregar habitación' }).click()
await page.waitForTimeout(400)
await auditar('hoja: agregar')
await page.getByRole('button', { name: 'Usar una foto que ya tengo' }).click()
await page.waitForTimeout(400)
await auditar('subir foto')
await page.locator('input[type=file]').first().setInputFiles('public/panoramas/sala.jpg')
await page.waitForTimeout(2500)
await auditar('subir foto (cargada)')
await page.getByRole('button', { name: 'Guardar habitación' }).click()
await page.waitForTimeout(3000)
await auditar('editor de puntos')
await page.getByRole('button', { name: 'Poner punto en la mira' }).click()
await page.waitForTimeout(500)
await auditar('hoja: punto nuevo')
await page.getByPlaceholder('Sala 4.2 × 3.8 m').fill('Nota')
await page.getByRole('button', { name: 'Agregar', exact: true }).click()
await page.waitForTimeout(800)
await page.getByRole('button', { name: 'Regresar' }).click()
await page.waitForTimeout(900)
await auditar('editor con 1 cuarto')
await page.getByRole('button', { name: 'Ajustes' }).click()
await page.waitForTimeout(400)
await auditar('hoja: ajustes')

console.log(`\n${bien ? 'TODO SE PUEDE TOCAR' : 'HAY CONTROLES DEMASIADO CHICOS'}`)
console.log('errores de consola:', errores.length ? errores : 'ninguno')
await browser.close()
process.exit(bien && errores.length === 0 ? 0 : 1)

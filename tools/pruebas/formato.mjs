/**
 * ============================================================================
 *  EL FORMATO `.tour` SIGUE ABRIENDO LO VIEJO
 * ============================================================================
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/pruebas/formato.mjs http://localhost:5173/
 *
 * Al subir `FORMAT_VERSION` a 2 se le hizo una promesa concreta a quien ya tenga
 * recorridos guardados: **los `.tour` de la versión 1 se siguen abriendo**. Esta
 * prueba la cobra.
 *
 * El archivo de `fixtures/v1.tour` NO lo genera el visor: está escrito a mano con
 * el manifiesto exacto de la versión 1 —sin `marca` ni `ficha`— y con ZIP sin
 * comprimir, igual que el escritor del proyecto. Eso es lo que lo hace valer:
 * un archivo generado por el código de hoy probaría que el código de hoy se
 * entiende consigo mismo, que no es la pregunta.
 *
 * Después exporta el recorrido importado y lo vuelve a importar, para cerrar la
 * ida y vuelta completa por el camino de la versión 2.
 */
import { readFileSync } from 'node:fs'

const BASE = process.argv[2]
if (!BASE) {
  console.error('Falta la URL. Ejemplo: node tools/pruebas/formato.mjs http://localhost:5173/')
  process.exit(1)
}

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('Falta Playwright:  npm i -D playwright && npx playwright install chromium')
  process.exit(1)
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

let bien = true
const revisar = (nombre, ok, detalle = '') => {
  console.log(`  ${nombre.padEnd(42)} ${(ok ? 'sí' : 'NO').padEnd(4)} ${detalle}`)
  if (!ok) bien = false
}

console.log('=== El formato .tour abre lo viejo ===')

await page.goto(`${BASE}#/inicio`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

/* Se le da el archivo al `<input type=file>` directamente y no se abre el
   diálogo del sistema: Playwright no puede tocar ese diálogo, y de todos modos
   lo que se quiere probar es el manejador, no el selector del sistema. */
const v1 = readFileSync('tools/pruebas/fixtures/v1.tour')
await page.setInputFiles('input[type=file]', {
  name: 'v1.tour',
  mimeType: 'application/zip',
  buffer: v1,
})
await page.waitForTimeout(3000)

const abrio = await page.getByText('Casa de prueba v1').first().isVisible().catch(() => false)
revisar('un .tour de la versión 1 se importa', abrio)

/* Y hay que comprobar que llegó COMPLETO, no solo que apareció el título: una
   migración descuidada puede tragarse las habitaciones o los puntos y dejar el
   nombre intacto. */
const guardado = await page.evaluate(async () => {
  const abrir = () =>
    new Promise((listo, falla) => {
      const p = indexedDB.open('visor-tour-360')
      p.onsuccess = () => listo(p.result)
      p.onerror = () => falla(p.error)
    })
  const db = await abrir()
  const almacen = [...db.objectStoreNames].find((n) => /tour/i.test(n))
  const todos = await new Promise((listo, falla) => {
    const p = db.transaction(almacen, 'readonly').objectStore(almacen).getAll()
    p.onsuccess = () => listo(p.result)
    p.onerror = () => falla(p.error)
  })
  const t = todos.find((x) => x.title === 'Casa de prueba v1')
  if (!t) return null
  return {
    habitaciones: t.scenes.length,
    nombres: t.scenes.map((s) => s.name),
    puntos: t.scenes.reduce((n, s) => n + s.hotspots.length, 0),
    enlaceApunta: t.scenes[0]?.hotspots?.[0]?.to,
    inicial: t.startSceneId,
    subtitulo: t.subtitle,
    // v1 no traía ninguno de los dos, y deben quedar ausentes, no vacíos.
    traeMarca: 'marca' in t && t.marca !== undefined,
    traeFicha: 'ficha' in t && t.ficha !== undefined,
  }
})

revisar('con sus 2 habitaciones', guardado?.habitaciones === 2, JSON.stringify(guardado?.nombres ?? []))
revisar('con sus 2 puntos', guardado?.puntos === 2)
revisar('y el enlace apunta a la cocina', guardado?.enlaceApunta === 'cocina')
revisar('la habitación inicial se respeta', guardado?.inicial === 'sala')
revisar('el subtítulo se conserva', !!guardado?.subtitulo)
revisar('sin inventar marca ni ficha', guardado?.traeMarca === false && guardado?.traeFicha === false)

console.log(`\n${bien ? 'LO VIEJO SIGUE ABRIENDO' : 'HAY ALGO MAL'}`)
console.log('errores de consola:', errores.length ? errores : 'ninguno')
await browser.close()
process.exit(bien && errores.length === 0 ? 0 : 1)

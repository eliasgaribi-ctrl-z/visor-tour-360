/**
 * ============================================================================
 *  REORDENAR HABITACIONES ARRASTRANDO, Y QUE EL ORDEN SE GUARDE DE VERDAD
 * ============================================================================
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/pruebas/reordenar.mjs http://localhost:5173/
 *
 * Se arma un recorrido con tres habitaciones POR LA INTERFAZ, se arrastra el
 * asa de la primera hasta el final con el ratón, se RECARGA la página y se lee
 * el orden desde IndexedDB. Recargar es la parte que importa: un orden que solo
 * cambió en la pantalla y no en la base es exactamente el fallo que un arnés
 * que mira el DOM no ve.
 *
 * Y las cuatro cosas que un arrastre a mano rompe con facilidad:
 *   · un toque sobre el asa —o un roce de menos de 8 px— NO levanta la fila ni
 *     reordena;
 *   · `pointercancel` a medio camino (una llamada entrante en iOS) REVIERTE: ni
 *     orden a medias en la base ni filas con transform;
 *   · los botones ↑/↓ siguen funcionando: son la única ruta con teclado;
 *   · el asa mide ≥ 44 px y es lo ÚNICO con `touch-action: none`. Con la lista
 *     entera bloqueada, tres habitaciones ya no cabrían y no se podría scrollear.
 */

const BASE = process.argv[2]
if (!BASE) {
  console.error('Falta la URL. Ejemplo: node tools/pruebas/reordenar.mjs http://localhost:5173/')
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const errores = []
page.on('console', (m) => {
  if (m.type() === 'error') errores.push(m.text())
})
page.on('pageerror', (e) => errores.push(String(e)))

let bien = true
const revisar = (nombre, ok, detalle = '') => {
  console.log(`  ${nombre.padEnd(46)} ${(ok ? 'sí' : 'NO').padEnd(4)} ${detalle}`)
  if (!ok) bien = false
}

/** El orden de las habitaciones tal como está GUARDADO, no como se ve. */
const ordenGuardado = () =>
  page.evaluate(async () => {
    const mod = await import('/src/lib/store/tours.ts')
    const lista = await mod.listTours()
    const fila = lista.find((t) => t.title === 'Prueba de orden')
    if (!fila) return null
    const tour = await mod.getTour(fila.id)
    return { id: tour.id, nombres: tour.scenes.map((s) => s.name), entrada: tour.startSceneId }
  })

console.log('=== Un recorrido con tres habitaciones, por la interfaz ===')
await page.goto(`${BASE}#/inicio`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.getByRole('button', { name: 'Nuevo recorrido' }).click()
await page.getByPlaceholder('Casa en Tlajomulco').fill('Prueba de orden')
await page.getByRole('button', { name: 'Crear', exact: true }).click()
await page.waitForTimeout(800)

for (const [nombre, foto] of [['Sala', 'sala.jpg'], ['Cocina', 'cocina.jpg'], ['Recámara', 'recamara.jpg']]) {
  await page.getByRole('button', { name: 'Agregar habitación' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Usar una foto que ya tengo' }).click()
  await page.waitForTimeout(400)
  await page.locator('input[type=file]').first().setInputFiles(`public/panoramas/${foto}`)
  await page.waitForTimeout(2500)
  await page.getByRole('textbox', { name: 'Nombre de la habitación' }).fill(nombre)
  await page.getByRole('button', { name: 'Guardar habitación' }).click()
  await page.waitForTimeout(3000)
  // Aterriza en el editor de puntos; de vuelta a la lista.
  await page.getByRole('button', { name: 'Regresar' }).click()
  await page.waitForTimeout(1000)
}
const inicial = await ordenGuardado()
revisar('tres habitaciones guardadas', inicial?.nombres.join(',') === 'Sala,Cocina,Recámara', inicial?.nombres.join(','))

/* ── El asa ─────────────────────────────────────────────────────────────── */
console.log('\n=== El asa ===')
const asa = page.getByRole('button', { name: 'Arrastrar Sala' })
const caja = await asa.boundingBox()
revisar('el asa mide ≥ 44 px', !!caja && caja.width >= 44 && caja.height >= 44, caja ? `${Math.round(caja.width)}×${Math.round(caja.height)}` : 'no está')
const soloElAsa = await page.evaluate(() => {
  const asas = [...document.querySelectorAll('button[aria-label^="Arrastrar"]')]
  const bloqueadas = asas.every((b) => getComputedStyle(b).touchAction === 'none')
  const lista = asas[0]?.closest('.overflow-y-auto')
  return { bloqueadas, listaLibre: !!lista && getComputedStyle(lista).touchAction !== 'none' }
})
revisar('touch-action: none solo en el asa, no en la lista', soloElAsa.bloqueadas && soloElAsa.listaLibre, JSON.stringify(soloElAsa))

/* ── Un toque no reordena ───────────────────────────────────────────────── */
console.log('\n=== Lo que no debe reordenar ===')
await asa.click()
await page.waitForTimeout(600)
let ahora = await ordenGuardado()
revisar('un toque sobre el asa no mueve nada', ahora.nombres.join(',') === 'Sala,Cocina,Recámara', ahora.nombres.join(','))

const centro = { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 }
await page.mouse.move(centro.x, centro.y)
await page.mouse.down()
await page.mouse.move(centro.x, centro.y + 5, { steps: 3 }) // menos del umbral de 8 px
/* Lo que protege el umbral no es el orden —con 5 px el destino sigue siendo la
   misma fila y no se guardaría nada de todos modos— sino que la fila NO se
   levante con un roce. Se mira ANTES de soltar, que es cuando se vería. */
const seLevanto = await page.evaluate(() =>
  [...document.querySelectorAll('[data-fila]')].some((f) => f.style.transform),
)
await page.mouse.up()
await page.waitForTimeout(600)
ahora = await ordenGuardado()
revisar('un movimiento de 5 px no levanta la fila', !seLevanto)
revisar('ni reordena', ahora.nombres.join(',') === 'Sala,Cocina,Recámara', ahora.nombres.join(','))

/* ── Arrastrar la primera hasta el final ───────────────────────────────── */
console.log('\n=== Arrastrar la Sala hasta el final ===')
const filaRecamara = await page.getByRole('button', { name: 'Arrastrar Recámara' }).boundingBox()
await page.mouse.move(centro.x, centro.y)
await page.mouse.down()
// Pasos chicos, como un dedo: el umbral se cruza y luego se recorre la lista.
const destinoY = filaRecamara.y + filaRecamara.height / 2 + 20
const pasos = 14
for (let i = 1; i <= pasos; i++) {
  await page.mouse.move(centro.x, centro.y + ((destinoY - centro.y) * i) / pasos)
  await page.waitForTimeout(30)
}
/* Mientras se arrastra, la fila lleva un transform y las demás se corren: eso
   es lo que el usuario ve. Se comprueba ANTES de soltar. */
const enVuelo = await page.evaluate(() => {
  const filas = [...document.querySelectorAll('button[aria-label^="Arrastrar"]')].map((b) =>
    b.closest('[data-fila]'),
  )
  return filas.map((f) => (f ? f.style.transform : ''))
})
revisar('la fila arrastrada se mueve y las otras abren hueco', enVuelo[0].includes('translate3d') && enVuelo[1].includes('translate3d'), JSON.stringify(enVuelo))
await page.mouse.up()
await page.waitForTimeout(1200)

ahora = await ordenGuardado()
revisar('al soltar, la Sala queda al final', ahora.nombres.join(',') === 'Cocina,Recámara,Sala', ahora.nombres.join(','))
const sinTransforms = await page.evaluate(() =>
  [...document.querySelectorAll('button[aria-label^="Arrastrar"]')].every((b) => !b.closest('[data-fila]')?.style.transform),
)
revisar('y las filas quedan limpias, sin transform', sinTransforms)

/* La parte que importa: RECARGAR y volver a leer. */
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const trasRecargar = await ordenGuardado()
revisar('el orden sobrevive a recargar', trasRecargar?.nombres.join(',') === 'Cocina,Recámara,Sala', trasRecargar?.nombres.join(','))
const enPantalla = await page.evaluate(() =>
  [...document.querySelectorAll('button[aria-label^="Arrastrar"]')].map((b) => b.getAttribute('aria-label').replace('Arrastrar ', '')),
)
revisar('y la pantalla lo muestra igual', enPantalla.join(',') === 'Cocina,Recámara,Sala', enPantalla.join(','))
revisar('la habitación de entrada no cambió', trasRecargar?.entrada === inicial?.entrada, `${inicial?.entrada} → ${trasRecargar?.entrada}`)

/* ── Los botones siguen ahí ─────────────────────────────────────────────── */
console.log('\n=== Los botones ↑/↓ siguen funcionando ===')
await page.getByRole('button', { name: 'Subir Sala' }).click()
await page.waitForTimeout(800)
ahora = await ordenGuardado()
revisar('↑ sube una posición', ahora.nombres.join(',') === 'Cocina,Sala,Recámara', ahora.nombres.join(','))
await page.getByRole('button', { name: 'Bajar Cocina' }).click()
await page.waitForTimeout(800)
ahora = await ordenGuardado()
revisar('↓ baja una posición', ahora.nombres.join(',') === 'Sala,Cocina,Recámara', ahora.nombres.join(','))

/* ── Cancelar a medio arrastre revierte, no guarda ──────────────────────────
 * En iOS una llamada entrante manda `pointercancel` con el dedo a medio camino.
 * Guardar el orden a medias sería peor que no haber movido nada: las filas
 * vuelven a su sitio y la base se queda como estaba. Chromium no tiene una
 * llamada entrante, así que el evento se despacha a mano sobre el asa; el
 * `pointerup` que llega después ya no encuentra ningún gesto que soltar. */
console.log('\n=== Cancelar a medio arrastre no guarda nada ===')
const asaSala = page.getByRole('button', { name: 'Arrastrar Sala' })
const cajaSala = await asaSala.boundingBox()
const c2 = { x: cajaSala.x + cajaSala.width / 2, y: cajaSala.y + cajaSala.height / 2 }
await page.mouse.move(c2.x, c2.y)
await page.mouse.down()
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(c2.x, c2.y + i * 30)
  await page.waitForTimeout(30)
}
const aMedias = await page.evaluate(() =>
  [...document.querySelectorAll('[data-fila]')].some((f) => f.style.transform),
)
revisar('a medio arrastre la fila va con el dedo', aMedias)
await asaSala.evaluate((el) => el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })))
await page.waitForTimeout(300)
const limpiasTrasCancelar = await page.evaluate(() =>
  [...document.querySelectorAll('[data-fila]')].every((f) => !f.style.transform),
)
revisar('al cancelar, las filas vuelven a su sitio', limpiasTrasCancelar)
await page.mouse.up()
await page.waitForTimeout(800)
ahora = await ordenGuardado()
revisar('y el orden no cambió', ahora.nombres.join(',') === 'Sala,Cocina,Recámara', ahora.nombres.join(','))

console.log(`\n${bien ? 'EL ORDEN SE GUARDA' : 'HAY ALGO MAL'}`)
console.log('errores de consola:', errores.length ? errores : 'ninguno')
await browser.close()
process.exit(bien && errores.length === 0 ? 0 : 1)

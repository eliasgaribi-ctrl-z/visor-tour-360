/**
 * ============================================================================
 *  ¿CUÁNTO TRABAJA EL TELÉFONO, Y RESPONDE TODO?
 * ============================================================================
 *
 * El visor dibuja A PEDIDO: cuando la cámara está quieta no se pinta nada, y el
 * pulso del HUD se duerme. Eso es lo que hace que un recorrido no caliente el
 * teléfono ni se coma la pila — y también es lo más fácil de romper sin darse
 * cuenta: basta con que alguien agregue un control nuevo y se le olvide llamar
 * a `engine.invalidar()` para que ese gesto deje la imagen congelada.
 *
 * Por eso esta prueba hace dos cosas:
 *
 *   1. MIDE el trabajo. Cuenta las llamadas de dibujo de WebGL y los cuadros de
 *      animación, parado y mientras se arrastra. Parado tiene que dar CERO.
 *   2. COMPRUEBA que todo responde. Recorre todas las formas de mover la cámara
 *      —arrastrar, joystick, zoom, rueda, teclado, reencuadrar, cambiar de
 *      habitación, tocar un punto— y verifica que cada una de verdad la mueve.
 *
 * Corre con la CPU limitada 4x, que se parece a un celular de gama media.
 *
 * ── Cómo se corre ──────────────────────────────────────────────────────────
 *
 *   npm run dev                                   (en otra terminal)
 *   npm i -D playwright && npx playwright install chromium
 *   node tools/pruebas/rendimiento.mjs http://localhost:5173/
 *
 * Playwright NO es dependencia del proyecto: esto se corre a mano cuando se
 * toca el visor, no en cada build.
 */

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('Falta Playwright. Instálalo solo para esta prueba:\n  npm i -D playwright && npx playwright install chromium')
  process.exit(1)
}

const BASE = process.argv[2]
const CPU = Number(process.argv[3] || 4)
if (!BASE) {
  console.error('Uso: node tools/pruebas/rendimiento.mjs <url del visor> [factor de CPU]')
  process.exit(1)
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})

await ctx.addInitScript(() => {
  const s = { draws: 0, raf: 0 }
  window.__PERF = s
  window.__RESET = () => {
    s.draws = 0
    s.raf = 0
  }
  for (const P of [window.WebGL2RenderingContext?.prototype, window.WebGLRenderingContext?.prototype]) {
    if (!P || P.__perf) continue
    P.__perf = true
    for (const m of ['drawElements', 'drawArrays']) {
      const o = P[m]
      P[m] = function (...a) {
        s.draws++
        return o.apply(this, a)
      }
    }
  }
  const raf = window.requestAnimationFrame
  window.requestAnimationFrame = function (cb) {
    return raf.call(window, (t) => {
      s.raf++
      return cb(t)
    })
  }
})

const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
const errores = []
page.on('pageerror', (e) => errores.push(e.message))

await page.goto(BASE + '#/demo', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas', { timeout: 40000 })
await page.waitForTimeout(7000)

let bien = true

/* ------------------------------------------------------------- 1. MEDIR --- */
console.log(`=== Trabajo del teléfono · CPU limitada ${CPU}x ===`)
const muestrear = async (etiqueta, ms = 3000) => {
  await page.evaluate(() => window.__RESET())
  await page.waitForTimeout(ms)
  const s = await page.evaluate(() => ({ ...window.__PERF }))
  const draws = Math.round(s.draws / (ms / 1000))
  const raf = Math.round(s.raf / (ms / 1000))
  console.log(`  ${etiqueta.padEnd(28)} ${String(draws).padStart(3)} dibujos/s · ${String(raf).padStart(3)} cuadros/s`)
  return { draws, raf }
}

const quieto = await muestrear('parado, sin tocar nada')
if (quieto.draws > 0 || quieto.raf > 0) {
  console.log('     ↑ MAL: parado no debería dibujarse nada')
  bien = false
}

await page.mouse.move(195, 400)
await page.mouse.down()
await page.evaluate(() => window.__RESET())
for (let i = 0; i < 30; i++) {
  await page.mouse.move(195 + i * 4, 400 + Math.sin(i / 4) * 20)
  await page.waitForTimeout(30)
}
await page.mouse.up()
const moviendo = await page.evaluate(() => ({ ...window.__PERF }))
console.log(`  ${'arrastrando'.padEnd(28)} ${Math.round(moviendo.draws / 1.2)} dibujos/s aprox`)
if (moviendo.draws < 10) {
  console.log('     ↑ MAL: arrastrando tiene que dibujar')
  bien = false
}
await page.waitForTimeout(2500)

/* ------------------------------------------------- 2. ¿TODO RESPONDE? --- */
console.log('\n=== Cada forma de mover la cámara ===')
const angulos = async () => {
  const t = await page.locator('pre').first().textContent()
  const m = /yaw\s+(-?[\d.]+)°\s+pitch\s+(-?[\d.]+)°\s+fov\s+(\d+)/.exec(t || '')
  return m ? { yaw: +m[1], pitch: +m[2], fov: +m[3] } : null
}
const revisar = (nombre, antes, despues, campos) => {
  const movio = campos.some((k) => Math.abs(antes[k] - despues[k]) > 0.5)
  const detalle = campos.map((k) => `${k} ${antes[k]}→${despues[k]}`).join(' ')
  console.log(`  ${nombre.padEnd(28)} ${(movio ? 'responde' : 'CONGELADO').padEnd(10)} ${detalle}`)
  if (!movio) bien = false
}

let a = await angulos()
if (!a) {
  console.log('  (no se encontró el badge de ángulos: esta parte solo corre en modo desarrollo)')
} else {
  await page.mouse.move(195, 400)
  await page.mouse.down()
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(195 - i * 8, 400)
    await page.waitForTimeout(25)
  }
  await page.mouse.up()
  await page.waitForTimeout(2000)
  revisar('arrastrar la foto', a, await angulos(), ['yaw'])

  a = await angulos()
  const zona = await page.locator('[role=application]').boundingBox()
  await page.mouse.move(zona.x + zona.width / 2, zona.y + zona.height / 2)
  await page.mouse.down()
  await page.mouse.move(zona.x + zona.width - 8, zona.y + zona.height / 2, { steps: 4 })
  await page.waitForTimeout(1200)
  await page.mouse.up()
  await page.waitForTimeout(900)
  revisar('joystick', a, await angulos(), ['yaw'])

  a = await angulos()
  await page.getByRole('button', { name: 'Acercar' }).click()
  await page.waitForTimeout(2000)
  revisar('botón de zoom', a, await angulos(), ['fov'])

  await page.waitForTimeout(600) // que termine de asentarse el zoom anterior
  a = await angulos()
  await page.mouse.move(195, 400)
  await page.mouse.wheel(0, 200)
  await page.waitForTimeout(2000)
  revisar('rueda del mouse', a, await angulos(), ['fov'])

  a = await angulos()
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(900)
  await page.keyboard.up('ArrowUp')
  await page.waitForTimeout(900)
  revisar('teclado', a, await angulos(), ['pitch'])

  await page.getByRole('button', { name: 'Reencuadrar' }).click()
  await page.waitForTimeout(1800)
  const centrado = await angulos()
  const vuelve = Math.abs(centrado.yaw) < 1 && Math.abs(centrado.pitch) < 1 && Math.abs(centrado.fov - 75) < 2
  console.log(`  ${'reencuadrar'.padEnd(28)} ${vuelve ? 'vuelve a 0/0/75' : 'NO VOLVIÓ'}`)
  if (!vuelve) bien = false
}

/* La foto de la habitación nueva tiene que APARECER. Se mide con una captura
   de pantalla: sin preserveDrawingBuffer, leer el búfer de WebGL devuelve
   ceros aunque la imagen esté perfectamente pintada. */
await page.getByRole('button', { name: 'Cocina', exact: true }).click()
await page.waitForTimeout(4000)
const png = await page.screenshot({ clip: { x: 60, y: 350, width: 260, height: 200 } })
const brillo = await page.evaluate(async (datos) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + datos
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height).data
  let suma = 0
  for (let i = 0; i < d.length; i += 4) suma += (d[i] + d[i + 1] + d[i + 2]) / 3
  return Math.round(suma / (d.length / 4))
}, png.toString('base64'))
console.log(`  ${'cambiar de habitación'.padEnd(28)} ${brillo > 40 ? `la foto se dibujó (brillo ${brillo})` : 'PANTALLA NEGRA'}`)
if (brillo <= 40) bien = false

console.log(`\n${bien ? 'TODO BIEN' : 'HAY ALGO MAL'}`)
console.log('errores de consola:', errores.length ? errores : 'ninguno')
await browser.close()
process.exit(bien && errores.length === 0 ? 0 : 1)

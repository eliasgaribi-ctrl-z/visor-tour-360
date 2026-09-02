/**
 * ============================================================================
 *  MIRAR CON EL TELÉFONO, Y QUE QUIETO SIGA DANDO CERO DIBUJOS
 * ============================================================================
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/pruebas/giroscopio.mjs http://localhost:5173/
 *
 * Chromium no emula los sensores, así que el arnés despacha
 * `DeviceOrientationEvent` a mano, a sesenta por segundo, como un teléfono de
 * verdad: con ruido chico cuando está "quieto" y con una rampa cuando "gira".
 * La conversión de sensores a ángulos ya está verificada en las nueve posturas
 * de la captura (README, sección 12); lo que se prueba aquí es el CABLEADO al
 * visor, y sobre todo la propiedad que más fácil se rompe con un sensor que no
 * para de hablar:
 *
 *   · con el teléfono quieto —sesenta lecturas por segundo, con ruido— el visor
 *     tiene que seguir dando CERO dibujos por segundo;
 *   · girar el teléfono 90° a la derecha gira la cámara 90° a la derecha, e
 *     inclinarlo 45° hacia arriba sube la vista 45°;
 *   · encenderlo y apagarlo NO mueve la cámara (el offset se elige para eso);
 *   · el dedo corrige y la siguiente lectura del sensor no lo deshace;
 *   · con la pestaña oculta se apaga; sin sensores, el botón se retira y lo dice.
 *
 * Las expectativas salen de la física, no del código: alpha crece en sentido
 * antihorario visto desde arriba, así que girar el teléfono a la DERECHA baja
 * alpha (300 → 210), y beta = 90 es el teléfono vertical, 135 es inclinado hacia
 * atrás mirando al cielo.
 */
const BASE = process.argv[2]
if (!BASE) {
  console.error('Falta la URL. Ejemplo: node tools/pruebas/giroscopio.mjs http://localhost:5173/')
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

/* Contar dibujos de WebGL y cuadros de rAF, igual que rendimiento.mjs. */
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
  /* El "teléfono": una postura (alpha, beta, gamma) que se despacha a 60 Hz con
     el ruido que se le pida, mientras `window.__sensor.activo` sea true. */
  window.__sensor = { activo: false, alpha: 0, beta: 90, gamma: 0, ruido: 0, enviados: 0 }
  setInterval(() => {
    const p = window.__sensor
    if (!p.activo) return
    const r = () => (Math.random() * 2 - 1) * p.ruido
    window.dispatchEvent(
      new DeviceOrientationEvent('deviceorientation', {
        alpha: ((p.alpha + r()) % 360 + 360) % 360,
        beta: p.beta + r(),
        gamma: p.gamma + r(),
        absolute: false,
      }),
    )
    p.enviados++
  }, 16)
})

const page = await ctx.newPage()
const errores = []
page.on('pageerror', (e) => errores.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errores.push(m.text())
})

let bien = true
const revisar = (nombre, ok, detalle = '') => {
  console.log(`  ${nombre.padEnd(46)} ${(ok ? 'sí' : 'NO').padEnd(4)} ${detalle}`)
  if (!ok) bien = false
}
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180

/** yaw/pitch del badge de desarrollo (solo existe con `npm run dev`). */
const angulos = async () => {
  const t = await page.locator('pre').first().textContent({ timeout: 1500 }).catch(() => null)
  const m = /yaw\s+(-?[\d.]+)°\s+pitch\s+(-?[\d.]+)°/.exec(t || '')
  return m ? { yaw: Number(m[1]), pitch: Number(m[2]) } : null
}
const sensor = (cambios) => page.evaluate((c) => Object.assign(window.__sensor, c), cambios)
const muestrear = async (etiqueta, ms) => {
  await page.evaluate(() => window.__RESET())
  await page.waitForTimeout(ms)
  const s = await page.evaluate(() => ({ ...window.__PERF }))
  const draws = Math.round(s.draws / (ms / 1000))
  const raf = Math.round(s.raf / (ms / 1000))
  console.log(`  ${etiqueta.padEnd(46)} ${String(draws).padStart(3)} dibujos/s · ${String(raf).padStart(3)} cuadros/s`)
  return { draws, raf }
}
const boton = () => page.getByRole('button', { name: /irar con el teléfono/ })
const joystick = () => page.locator('[role=application]').first()
/** Un punto sobre la foto, lejos de los controles del HUD. */
const sobreLaFoto = () =>
  page.evaluate(() => {
    for (const y of [400, 330, 470]) for (const x of [195, 120, 270]) {
      const e = document.elementFromPoint(x, y)
      if (e && e.tagName === 'CANVAS') return { x, y }
    }
    return null
  })

await page.goto(BASE + '#/demo', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas', { timeout: 40000 })
/* Ocho segundos y no cinco: la pista de arranque se retira sola a los siete, y
   ese re-render del visor cuesta un cuadro. Medido: con la ventana de "quieto"
   empezando antes, dos corridas de cinco contaron 1 dibujo/s que no era del
   sensor. */
await page.waitForTimeout(8000)

console.log('=== El botón ===')
revisar('el botón existe (https y evento disponibles)', await boton().isVisible())
revisar('y el joystick está a la vista', await joystick().isVisible())

console.log('\n=== Encender no mueve la cámara ===')
const antesDeEncender = await angulos()
/* El teléfono empieza a hablar en el mismo instante en que se enciende: el
   seguidor espera dos segundos por la primera lectura y si no llega concluye
   que no hay sensores.

   Y apunta a alpha 300 —60° a la derecha de su cero— a propósito: la cámara de
   la demo arranca en yaw 0, y con el teléfono también en 0 la aserción de "no
   salta" no podía fallar. Se comprobó saboteando el offset: seguía en verde. Con
   el teléfono girado, un rig que no compense salta 60° y se nota. */
await sensor({ activo: true, alpha: 300, beta: 90, gamma: 0, ruido: 0.02 })
await boton().click()
await page.waitForTimeout(1500)
revisar('el botón queda encendido', (await boton().getAttribute('aria-pressed')) === 'true')
revisar('y el joystick se retira', !(await joystick().isVisible().catch(() => false)))
const trasEncender = await angulos()
const saltoAlEncender = Math.abs(wrap180(trasEncender.yaw - antesDeEncender.yaw))
revisar('la cámara no salta al encender', saltoAlEncender < 1, `${saltoAlEncender.toFixed(2)}° de salto`)

console.log('\n=== Quieto, con el sensor hablando a 60 Hz ===')
const enviadosAntes = await page.evaluate(() => window.__sensor.enviados)
const quieto = await muestrear('teléfono quieto (ruido ±0.02°)', 3000)
const enviados = (await page.evaluate(() => window.__sensor.enviados)) - enviadosAntes
revisar('llegaron lecturas de verdad', enviados > 120, `${enviados} en 3 s`)
revisar('y aun así CERO dibujos', quieto.draws === 0 && quieto.raf === 0, `${quieto.draws} dibujos/s · ${quieto.raf} cuadros/s`)

console.log('\n=== Girar el teléfono gira la cámara ===')
const yawAntesDeGirar = (await angulos()).yaw
await page.evaluate(() => window.__RESET())
/* 90° a la derecha en 40 pasos, como una muñeca: alpha baja de 300 a 210. */
for (let i = 1; i <= 40; i++) {
  await sensor({ alpha: 300 - (90 * i) / 40 })
  await page.waitForTimeout(25)
}
const girando = await page.evaluate(() => ({ ...window.__PERF }))
await page.waitForTimeout(1200)
const yawGirado = (await angulos()).yaw
const giroCamara = wrap180(yawGirado - yawAntesDeGirar)
revisar('mientras gira, dibuja', girando.draws > 5, `${girando.draws} dibujos en el giro`)
revisar('90° a la derecha del teléfono son +90° de cámara', Math.abs(giroCamara - 90) < 3, `${giroCamara.toFixed(1)}°`)
await sensor({ beta: 135 })
await page.waitForTimeout(1200)
const pitchArriba = (await angulos()).pitch
revisar('inclinarlo 45° hacia atrás mira 45° arriba', Math.abs(pitchArriba - 45) < 3, `pitch ${pitchArriba.toFixed(1)}°`)
await sensor({ beta: 90 })
await page.waitForTimeout(1200)
const otraVezQuieto = await muestrear('quieto otra vez tras girar', 2500)
revisar('y al quedarse quieto vuelve a cero', otraVezQuieto.draws === 0, `${otraVezQuieto.draws} dibujos/s`)

console.log('\n=== El dedo corrige y el sensor no lo deshace ===')
const yawAntesDelDedo = (await angulos()).yaw
const punto = await sobreLaFoto()
revisar('la foto está a la vista', !!punto)
if (punto) {
  await page.mouse.move(punto.x, punto.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(punto.x + i * 15, punto.y)
    await page.waitForTimeout(20)
  }
  await page.mouse.up()
  await page.waitForTimeout(1000)
  const yawTrasDedo = (await angulos()).yaw
  const corrigio = Math.abs(wrap180(yawTrasDedo - yawAntesDelDedo))
  revisar('el arrastre mueve la vista', corrigio > 5, `${corrigio.toFixed(1)}°`)
  // El sensor sigue mandando la MISMA postura durante 1.5 s: no debe revertir.
  await page.waitForTimeout(1500)
  const yawDespues = (await angulos()).yaw
  const revertido = Math.abs(wrap180(yawDespues - yawTrasDedo))
  revisar('y la siguiente lectura no lo deshace', revertido < 1, `${revertido.toFixed(2)}° de deriva`)
}

console.log('\n=== Apagar tampoco mueve la cámara ===')
const antesDeApagar = (await angulos()).yaw
await boton().click()
await page.waitForTimeout(1000)
const trasApagar = (await angulos()).yaw
revisar('el botón queda apagado', (await boton().getAttribute('aria-pressed')) === 'false')
revisar('el joystick vuelve', await joystick().isVisible())
revisar('la cámara se queda donde estaba', Math.abs(wrap180(trasApagar - antesDeApagar)) < 1, `${Math.abs(wrap180(trasApagar - antesDeApagar)).toFixed(2)}°`)
// Con el sensor apagado, mover el "teléfono" no debe mover nada.
await sensor({ alpha: 180 })
await page.waitForTimeout(1200)
const conSensorApagado = (await angulos()).yaw
revisar('apagado, el teléfono ya no manda', Math.abs(wrap180(conSensorApagado - trasApagar)) < 1)

console.log('\n=== La pestaña oculta lo apaga ===')
await boton().click()
await page.waitForTimeout(1200)
revisar('encendido otra vez', (await boton().getAttribute('aria-pressed')) === 'true')
await page.evaluate(() => {
  Object.defineProperty(Document.prototype, 'visibilityState', {
    configurable: true,
    get: () => window.__vis ?? 'visible',
  })
  window.__vis = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
})
await page.waitForTimeout(500)
revisar('oculta, el botón se apaga solo', (await boton().getAttribute('aria-pressed')) === 'false')
await sensor({ alpha: 90 })
const ocultoYHablando = await muestrear('oculta, con el sensor hablando', 2000)
revisar('y el sensor ya no dibuja nada', ocultoYHablando.draws === 0, `${ocultoYHablando.draws} dibujos/s`)
await page.evaluate(() => {
  window.__vis = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
})

console.log('\n=== Sin sensores, el botón se retira y lo dice ===')
await sensor({ activo: false })
await boton().click()
await page.waitForTimeout(3000) // el seguidor espera 2 s por la primera lectura
revisar('el botón desaparece', !(await boton().isVisible().catch(() => false)))
revisar('y el aviso lo explica', await page.getByText(/no tiene sensores/).isVisible().catch(() => false))
revisar('el joystick sigue disponible', await joystick().isVisible())

console.log(`\n${bien ? 'EL GIROSCOPIO SIGUE A LA MANO Y QUIETO DIBUJA CERO' : 'HAY ALGO MAL'}`)
console.log('errores de consola:', errores.length ? errores : 'ninguno')
await browser.close()
process.exit(bien && errores.length === 0 ? 0 : 1)

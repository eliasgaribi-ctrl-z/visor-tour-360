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
 *   3. REVISA que con "reducir movimiento" el adorno que late se quede quieto y
 *      la rueda de "cargando" siga girando.
 *
 * El punto 2 necesita el badge de ángulos, que solo existe en modo desarrollo:
 * contra el sitio ya publicado esa parte se salta y lo dice.
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

/* Dónde tocar, sin dejarlo al azar.
 *
 * El HUD y los marcadores son HERMANOS del canvas, no hijos: si el cursor cae
 * encima de uno, el gesto va por otra rama del árbol y el manejador del visor
 * ni se entera. Antes esta prueba apretaba siempre en (195,400) y salía roja
 * una de cada tres veces, según dónde hubiera quedado mirando la cámara. Ahora
 * pregunta primero qué hay debajo. */
const sobreLaFoto = async () => {
  const r = await page.evaluate(() => {
    const encima = new Set()
    for (const y of [400, 330, 470, 260]) {
      for (const x of [195, 120, 270]) {
        const e = document.elementFromPoint(x, y)
        if (e && e.tagName === 'CANVAS') return { punto: { x, y } }
        encima.add(e ? `${e.tagName}.${String(e.className).split(' ').slice(0, 4).join('.')}` : 'nada')
      }
    }
    return { punto: null, encima: [...encima] }
  })
  /* Si la foto no está a la vista, casi siempre es que el visor está mostrando
     un aviso encima —"no se pudo cargar la foto", o el respaldo de sin WebGL—.
     Por eso el error dice QUÉ había encima: sin eso, apretar a ciegas daba un
     "arrastrando 1 dibujo/s" que parecía un problema de rendimiento y no lo
     era. */
  if (!r.punto) throw new Error(`la foto no está a la vista; encima hay: ${r.encima.join(' · ')}`)
  return r.punto
}
/** Centro de un marcador de la escena visible, o null si no hay ninguno.
 *  Se reconocen por el `transform` en línea que les escribe el pulso del HUD
 *  (ver src/components/ui/HotspotLayer.tsx); así no se confunden con los
 *  botones fijos del HUD, que también viven en esa capa. */
const sobreUnMarcador = async () =>
  page.evaluate(() => {
    for (const b of document.querySelectorAll('button[style*="translate3d"]')) {
      const r = b.getBoundingClientRect()
      if (getComputedStyle(b).visibility !== 'visible' || r.width < 20) continue
      if (r.left < 0 || r.top < 40 || r.right > innerWidth || r.bottom > innerHeight - 40) continue
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), texto: b.textContent.trim() }
    }
    return null
  })

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

const inicio = await sobreLaFoto()
await page.mouse.move(inicio.x, inicio.y)
await page.mouse.down()
await page.evaluate(() => window.__RESET())
for (let i = 0; i < 30; i++) {
  await page.mouse.move(inicio.x + i * 4, inicio.y + Math.sin(i / 4) * 20)
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
  /* El badge de ángulos solo existe en modo desarrollo. En el sitio ya
     publicado no está, y sin límite de espera propio esto se quedaba 30 s
     colgado y reventaba en vez de avisar. */
  let t = null
  try {
    t = await page.locator('pre').first().textContent({ timeout: 1500 })
  } catch {
    return null
  }
  const m = /yaw\s+(-?[\d.]+)°\s+pitch\s+(-?[\d.]+)°\s+fov\s+(\d+)/.exec(t || '')
  return m ? { yaw: +m[1], pitch: +m[2], fov: +m[3] } : null
}
/**
 * Con la CPU limitada, la cámara puede seguir acomodándose cuando se lee. Si
 * la primera lectura no muestra movimiento se espera y se vuelve a leer: eso
 * no esconde un fallo real —una cámara congelada sigue congelada un segundo
 * después— y evita el falso positivo por leer demasiado pronto.
 */
const revisar = async (nombre, antes, campos) => {
  let despues = await angulos()
  let movio = campos.some((k) => Math.abs(antes[k] - despues[k]) > 0.5)
  if (!movio) {
    await page.waitForTimeout(1500)
    despues = await angulos()
    movio = campos.some((k) => Math.abs(antes[k] - despues[k]) > 0.5)
  }
  const detalle = campos.map((k) => `${k} ${antes[k]}→${despues[k]}`).join(' ')
  console.log(`  ${nombre.padEnd(28)} ${(movio ? 'responde' : 'CONGELADO').padEnd(10)} ${detalle}`)
  if (!movio) bien = false
}

let a = await angulos()
if (!a) {
  console.log('  (no se encontró el badge de ángulos: esta parte solo corre en modo desarrollo)')
} else {
  const desde = await sobreLaFoto()
  await page.mouse.move(desde.x, desde.y)
  await page.mouse.down()
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(desde.x - i * 8, desde.y)
    await page.waitForTimeout(25)
  }
  await page.mouse.up()
  await page.waitForTimeout(2000)
  await revisar('arrastrar la foto', a, ['yaw'])

  a = await angulos()
  const zona = await page.locator('[role=application]').boundingBox()
  await page.mouse.move(zona.x + zona.width / 2, zona.y + zona.height / 2)
  await page.mouse.down()
  await page.mouse.move(zona.x + zona.width - 8, zona.y + zona.height / 2, { steps: 4 })
  await page.waitForTimeout(1200)
  await page.mouse.up()
  await page.waitForTimeout(900)
  await revisar('joystick', a, ['yaw'])

  a = await angulos()
  await page.getByRole('button', { name: 'Acercar' }).click()
  await page.waitForTimeout(2000)
  await revisar('botón de zoom', a, ['fov'])

  /* La rueda, en los dos sitios donde puede caer el cursor: sobre la foto y
     encima de un marcador. El segundo NO es un capricho: los marcadores están
     en la capa del HUD, que es hermana del canvas, y ahí el zoom no hacía nada
     —se notaba solo cuando la cámara quedaba mirando hacia un punto, o sea de
     vez en cuando. Ver useWheelZoom en src/lib/useDragLook.ts. */
  await page.waitForTimeout(600) // que termine de asentarse el zoom anterior
  const rodar = async (nombre, donde) => {
    const antes = await angulos()
    await page.mouse.move(donde.x, donde.y)
    await page.mouse.wheel(0, 200)
    await page.waitForTimeout(2000)
    const despues = await angulos()
    const movio = Math.abs(despues.fov - antes.fov) > 0.5
    console.log(`  ${nombre.padEnd(28)} ${(movio ? 'responde' : 'CONGELADO').padEnd(10)} fov ${antes.fov}\u2192${despues.fov}`)
    if (!movio) bien = false
  }
  await rodar('rueda sobre la foto', await sobreLaFoto())

  /* Girar hasta que se vea un marcador, para no depender de dónde quedó la
     cámara ni de los ángulos del recorrido de ejemplo. */
  let marcador = await sobreUnMarcador()
  for (let vuelta = 0; !marcador && vuelta < 12; vuelta++) {
    await page.keyboard.down('ArrowRight')
    await page.waitForTimeout(400)
    await page.keyboard.up('ArrowRight')
    await page.waitForTimeout(700)
    marcador = await sobreUnMarcador()
  }
  if (marcador) {
    await rodar(`rueda sobre «${marcador.texto}»`, marcador)
  } else {
    console.log(`  ${'rueda sobre un marcador'.padEnd(28)} NO SE ENCONTRÓ NINGUNO`)
    bien = false
  }

  a = await angulos()
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(900)
  await page.keyboard.up('ArrowUp')
  await page.waitForTimeout(900)
  await revisar('teclado', a, ['pitch'])

  await page.getByRole('button', { name: 'Reencuadrar' }).click()
  await page.waitForTimeout(1800)
  const centrado = await angulos()
  const vuelve = Math.abs(centrado.yaw) < 1 && Math.abs(centrado.pitch) < 1 && Math.abs(centrado.fov - 75) < 2
  console.log(`  ${'reencuadrar'.padEnd(28)} ${vuelve ? 'vuelve a 0/0/75' : 'NO VOLVIÓ'}`)
  if (!vuelve) bien = false

  /* ------------------------------------------------------------------------
   * REENCUADRAR DOS VECES SEGUIDAS  ·  regresión de un bug real
   *
   * "Reencuadrar" tiene que aterrizar en 75° EXACTOS, y no lo hacía. Pedía el
   * cambio como un delta calculado contra `readout.fov`, que es el FOV
   * SUAVIZADO y va por detrás del objetivo. Con el zoom todavía acomodándose,
   * el delta salía mal:
   *
   *   estando en 45 y subiendo hacia 75, el segundo toque calculaba
   *   75 − 50 = +25  sobre un objetivo que ya era 75  →  100, el tope.
   *
   * O sea que tocarlo dos veces dejaba la cámara en el FOV MÁS ABIERTO
   * posible, justo lo contrario de reencuadrar. Ahora el rig recibe el destino
   * ABSOLUTO (`input.gotoFov`) y el segundo toque es idempotente.
   *
   * Los dos toques van en el MISMO task de JavaScript, con `evaluate` y no con
   * dos `click()` de Playwright, y eso es lo que hace la prueba fiable: entre
   * ellos no se dibuja ni un cuadro, así que `readout.fov` no alcanza a
   * moverse y el delta se suma dos veces enteras. Con dos clicks normales la
   * prueba NO sirve —se probó— porque con la CPU limitada 4x pasan cientos de
   * milisegundos entre uno y otro, el zoom ya terminó, el delta sale 0 y el
   * segundo toque no hace nada. Un bug de carrera hay que provocarlo, no
   * esperar a tener suerte.
   * ---------------------------------------------------------------------- */
  const acercar = page.getByRole('button', { name: 'Acercar' })
  for (let i = 0; i < 4; i++) await acercar.click()
  await page.waitForTimeout(900)
  const acercado = await angulos()

  await page.evaluate(() => {
    const boton = [...document.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Reencuadrar' || b.textContent?.includes('Reencuadrar'),
    )
    if (!boton) throw new Error('no se encontró el botón de reencuadrar')
    boton.click()
    boton.click()
  })
  await page.waitForTimeout(1800)
  const doble = await angulos()

  /* ------------------------------------------------------------------------
   * LAS TECLAS DE LA CÁMARA NO SE ROBAN LO QUE ALGUIEN ESCRIBE
   *
   * useKeyboardLook escucha en `window` y hace preventDefault() sobre las
   * flechas y sobre a/s/w/d. Hoy el visor no monta ni un campo de texto, así
   * que el problema es LATENTE: en cuanto llegue uno (un formulario de
   * contacto, una nota, un buscador de habitaciones) escribir "casa" giraría
   * la cámara y las letras no llegarían al campo.
   *
   * Como no hay campo que usar, la prueba mete uno de verdad en el DOM, le da
   * el foco y dispara la tecla desde ahí. Comprueba las dos mitades: que el
   * evento NO quede cancelado (la letra llega al campo) y que la cámara no se
   * haya movido.
   * ---------------------------------------------------------------------- */
  /* ------------------------------------------------------------------------
   * PELLIZCO CON TRES DEDOS  ·  regresión de un bug anterior a estos cambios
   *
   * `pinchDistance` se fijaba solo al pasar a haber exactamente dos punteros, y
   * se limpiaba solo al bajar de dos. Con tres dedos apoyados eso deja un hueco:
   *
   *   A y B apoyados     ->  se guarda la distancia A-B
   *   entra un tercero C ->  el tamaño ya no es 2, no se recalcula nada
   *   se levanta A       ->  quedan B y C, tamaño 2 otra vez, pero la distancia
   *                          guardada sigue siendo la de A-B
   *
   * El siguiente movimiento compara peras con manzanas y el FOV se va al tope en
   * un solo evento. Tres dedos no es raro: sujetar el teléfono con una mano
   * mientras se pellizca con la otra, o un roce de la palma.
   *
   * Se usa CDP y no PointerEvents sintéticos a propósito: los toques de CDP
   * generan punteros REALES, con ids que el navegador conoce, así que
   * `setPointerCapture` funciona. Con eventos inventados tiraría NotFoundError.
   *
   * OJO con la semántica de `Input.dispatchTouchEvent`, que no es simétrica y se
   * verificó a mano instrumentando la página:
   *   · en `touchStart` y `touchMove`, `touchPoints` es el conjunto ACTIVO
   *     completo, y Chromium genera un evento por cada punto que cambió;
   *   · en `touchEnd`, en cambio, `touchPoints` son los dedos QUE SE LEVANTAN.
   * Mandar `touchEnd: [B, C]` creyendo que dejaba a B y C apoyados los soltaba a
   * los dos, el `touchMove` siguiente se interpretaba como dedos nuevos, y la
   * prueba pasaba en verde CON EL BUG PRESENTE. Una prueba vacua es peor que no
   * tenerla, así que quede escrito.
   * ---------------------------------------------------------------------- */
  await page.getByRole('button', { name: 'Reencuadrar' }).click()
  await page.waitForTimeout(1600)
  const antesDeTresDedos = await angulos()

  const dedo = (id, x, y) => ({ x, y, id })
  const A = dedo(1, 150, 420)
  const B = dedo(2, 240, 420) // A-B = 90 px
  const C = dedo(3, 330, 560) // B-C = hypot(90, 140) = 166 px

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [A] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [A, B] })
  await page.waitForTimeout(120)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [A, B, C] })
  await page.waitForTimeout(120)
  // Se levanta A —solo A— y quedan B y C, a una distancia muy distinta de A-B.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [A] })
  await page.waitForTimeout(120)
  // Y un movimiento mínimo del que queda.
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [B, dedo(3, 331, 560)],
  })
  await page.waitForTimeout(900)
  const trasTresDedos = await angulos()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [B, C] })

  /* Un píxel de movimiento no puede mover el FOV más de un grado o dos. El bug
     lo mandaba de 75 a 30 —el mínimo— de golpe. */
  const salto = Math.abs(trasTresDedos.fov - antesDeTresDedos.fov)
  const sinSalto = salto <= 3
  console.log(
    `  ${'pellizco con 3 dedos'.padEnd(28)} ${(sinSalto ? 'sin salto de FOV' : 'SALTÓ EL FOV').padEnd(10)} ` +
      `fov ${antesDeTresDedos.fov}\u2192${trasTresDedos.fov} (salto ${salto}°, tope 3°)`,
  )
  if (!sinSalto) bien = false

  /* Se espera a que la cámara se detenga del todo ANTES de medir: el contador
     de dibujos solo dice algo si se parte de cero de verdad. */
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.__RESET())

  const tecladoEnCampo = await page.evaluate(async () => {
    const campo = document.createElement('input')
    campo.type = 'text'
    /* Fuera del flujo y de un píxel: un `<input>` normal metido en el body
       cambia el layout, y ese cambio dispara el ResizeObserver de HotspotLayer,
       que por contrato llama a `invalidar()`. Se medían 2 dibujos que eran de la
       prueba, no del producto — y "arreglar" el producto para callar eso habría
       sido perseguir un fantasma. */
    campo.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0'
    document.body.appendChild(campo)
    campo.focus()

    const teclas = ['c', 'a', 's', 'a', ' ', 's', 'a', 'l', 'a', ' ', 'w', 'o', 'w']
    let cancelados = 0
    for (const key of teclas) {
      const abajo = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      campo.dispatchEvent(abajo)
      if (abajo.defaultPrevented) cancelados++
      campo.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 12))
    }

    /* Y una tecla con modificador, que es el otro camino: el keydown sale por el
       guard de modificadores, así que nada entra en `pressed`… y el keyup no
       debería despertar a nadie tampoco. */
    campo.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }),
    )
    campo.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }),
    )

    document.body.removeChild(campo)
    return { cancelados, escrito: campo.value }
  })

  // Pasado DESPIERTO_MS (250 ms) el pulso ya se durmió, si es que llegó a despertar.
  await page.waitForTimeout(900)
  const trasEscribir = await angulos()
  const perfEscribir = await page.evaluate(() => ({ ...window.__PERF }))

  /* Las tres mitades del asunto, y la tercera es la que faltaba:
       1. las letras llegan al campo (ningún keydown cancelado),
       2. la cámara no se movió,
       3. y NO SE DIBUJÓ NI UN CUADRO.
     La versión anterior de esta prueba solo miraba 1 y 2, y por eso dio verde
     mientras el `keyup` seguía llamando a `invalidar()` en cada letra: medido,
     escribir esto mismo daba 8 dibujos y 67 rAF. El pulso del HUD no se dormía
     mientras alguien escribía. Un arnés que mira la mitad de un contrato da una
     confianza falsa que dura años. */
  const respeta =
    tecladoEnCampo.cancelados === 0 &&
    Math.abs(trasEscribir.yaw - doble.yaw) < 0.5 &&
    perfEscribir.draws === 0
  console.log(
    `  ${'escribir en un campo'.padEnd(28)} ${(respeta ? 'ni una tecla robada' : 'SE ROBA LA TECLA').padEnd(10)} ` +
      `cancelados ${tecladoEnCampo.cancelados}/13 · yaw ${doble.yaw}\u2192${trasEscribir.yaw} · ` +
      `${perfEscribir.draws} dibujos · ${perfEscribir.raf} rAF`,
  )
  if (!respeta) bien = false

  const exacto = Math.abs(doble.fov - 75) < 1
  console.log(
    `  ${'reencuadrar x2 rápido'.padEnd(28)} ${(exacto ? 'fov 75 exacto' : 'SE PASÓ').padEnd(10)} ` +
      `${acercado.fov}\u2192${doble.fov} (esperado 75)`,
  )
  if (!exacto) bien = false
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

/* --------------------------------------------- 3. ¿MENOS MOVIMIENTO? ---
 * Con "reducir movimiento" activo, el aro que late en los puntos de enlace
 * tiene que quedarse quieto —es adorno, y una animación infinita mantiene
 * despierto al compositor— y la rueda de "cargando" tiene que seguir girando,
 * porque ahí el movimiento sí dice algo.
 *
 * Se revisa en una pestaña aparte: `reducedMotion` se fija al crear el
 * contexto y no se puede cambiar a media sesión. */
console.log('\n=== Si el teléfono pide menos movimiento ===')
const quieta = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  reducedMotion: 'reduce',
})
const hoja = await quieta.newPage()
await hoja.goto(BASE, { waitUntil: 'networkidle' })
await hoja.waitForTimeout(3000)
const animaciones = await hoja.evaluate(() => {
  const nombre = (sel) => {
    const e = document.querySelector(sel)
    return e ? getComputedStyle(e).animationName : 'no está en pantalla'
  }
  return { aro: nombre('.animate-ping'), rueda: nombre('.animate-spin') }
})
/* Se exige que el aro EXISTA: si un cambio se lleva la clase por delante, la
   prueba tiene que gritarlo, no dar por bueno que no encontró nada. */
const aroQuieto = animaciones.aro === 'none'
const detalle = aroQuieto ? 'quieto' : `SIGUE LATIENDO (${animaciones.aro})`
console.log(`  ${'aro de los enlaces'.padEnd(28)} ${detalle}`)
/* La otra mitad del contrato, que solo se imprimía: con "reducir movimiento" el
   aro deja de latir PERO la rueda de cargando tiene que SEGUIR girando, porque
   ahí el movimiento sí dice algo (que la foto viene en camino). Se demostró que
   no se afirmaba: poniendo `.animate-spin { animation: none }` dentro del bloque
   de reduced-motion, el arnés lo imprimía y salía en verde. */
const ruedaGira = animaciones.rueda !== 'none' && animaciones.rueda !== 'no está en pantalla'
console.log(
  `  ${'rueda de cargando'.padEnd(28)} ${ruedaGira ? animaciones.rueda : `SE PARÓ (${animaciones.rueda})`}`,
)
if (!ruedaGira) bien = false
if (!aroQuieto) bien = false

/* El fundido entre habitaciones también se acorta con "reducir movimiento"
 * (0.55 s -> 0.12 s, ver PanoSphere). Lo que hay que proteger al acortarlo NO
 * es la duración, es que la foto siga APARECIENDO: el fundido existe para que
 * no haya un frame en negro mientras la textura nueva termina de subir a la
 * GPU, y bajarlo a cero traería ese problema de vuelta.
 *
 * La duración en sí no se cronometra a propósito: los draws de esos primeros
 * cientos de milisegundos los domina la animación de la cámara hacia el
 * arriveYaw del punto, no el fundido, así que un número medido ahí diría más
 * sobre el damp de la cámara que sobre lo que se quiere verificar. Medir mal es
 * peor que no medir. */
const confirmado = await hoja.evaluate(() => !!matchMedia('(prefers-reduced-motion: reduce)').matches)
await hoja.getByRole('button', { name: 'Cocina', exact: true }).click()
await hoja.waitForTimeout(3000)
const pngQuieta = await hoja.screenshot({ clip: { x: 60, y: 350, width: 260, height: 200 } })
const brilloQuieta = await hoja.evaluate(async (datos) => {
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
}, pngQuieta.toString('base64'))
const pintoQuieta = confirmado && brilloQuieta > 40
console.log(
  `  ${'fundido corto: la foto sale'.padEnd(28)} ${
    pintoQuieta ? `sí (brillo ${brilloQuieta})` : `NO (reduce=${confirmado}, brillo ${brilloQuieta})`
  }`,
)
if (!pintoQuieta) bien = false

await quieta.close()

console.log(`\n${bien ? 'TODO BIEN' : 'HAY ALGO MAL'}`)
console.log('errores de consola:', errores.length ? errores : 'ninguno')
await browser.close()
process.exit(bien && errores.length === 0 ? 0 : 1)

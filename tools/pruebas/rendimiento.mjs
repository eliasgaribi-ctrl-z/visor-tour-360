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
const sobreLaFoto = async (pg = page) => {
  const r = await pg.evaluate(() => {
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
const sobreUnMarcador = async (pg = page, filtro = null) =>
  pg.evaluate((patron) => {
    const re = patron ? new RegExp(patron) : null
    for (const b of document.querySelectorAll('button[style*="translate3d"]')) {
      const r = b.getBoundingClientRect()
      if (getComputedStyle(b).visibility !== 'visible' || r.width < 20) continue
      if (r.left < 0 || r.top < 40 || r.right > innerWidth || r.bottom > innerHeight - 40) continue
      const texto = b.textContent.trim()
      if (re && !re.test(texto)) continue
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), texto }
    }
    return null
  }, filtro ? filtro.source : null)

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
const angulos = async (pg = page) => {
  /* El badge de ángulos solo existe en modo desarrollo. En el sitio ya
     publicado no está, y sin límite de espera propio esto se quedaba 30 s
     colgado y reventaba en vez de avisar. */
  let t = null
  try {
    t = await pg.locator('pre').first().textContent({ timeout: 1500 })
  } catch {
    return null
  }
  /* `empuje` es opcional en la expresión: es el desplazamiento de la cámara al
     cruzar una puerta (ver CameraRig) y el badge lo agrega al final. */
  const m = /yaw\s+(-?[\d.]+)°\s+pitch\s+(-?[\d.]+)°\s+fov\s+(\d+)°?(?:\s+empuje\s+(-?[\d.]+))?/.exec(t || '')
  return m ? { yaw: +m[1], pitch: +m[2], fov: +m[3], empuje: m[4] === undefined ? null : +m[4] } : null
}

/**
 * Lee el empuje del badge muchas veces seguidas durante `ms` milisegundos.
 * Es la única forma de ver una animación de 0.6 s desde fuera: una sola lectura
 * cae donde cae.
 */
const muestrearEmpuje = async (pg, ms = 1600, paso = 40) => {
  const valores = []
  const fin = Date.now() + ms
  while (Date.now() < fin) {
    const a = await angulos(pg)
    if (a && a.empuje !== null) valores.push(a.empuje)
    await pg.waitForTimeout(paso)
  }
  return valores
}

/**
 * Gira hasta que se vea un marcador de ENLACE (una puerta), ARRASTRANDO la foto.
 *
 * Arrastrando y no con la flecha del teclado, y es una lección del CI: la
 * primera versión giraba con `ArrowRight` y en la pestaña de reduced-motion de
 * GitHub Actions dio catorce vueltas sin ver ninguna puerta —mientras en local
 * la encontraba a la primera— y salió con "NO SE ENCONTRÓ NINGUNA PUERTA" sin
 * decir nada más. El arrastre es la interacción que esta prueba ya usa desde su
 * primera línea y que el CI ejercita en las dos pestañas, así que no depende de
 * a quién le llegue el teclado.
 *
 * Y si aun así no aparece, la razón se imprime: cuántos marcadores hay, qué
 * dicen, si están visibles y cuánto giró la cámara. Un "no se encontró" a secas
 * es lo que dejó el fallo anterior sin diagnóstico.
 */
const PUERTAS = /Cocina|Recámara|Volver a sala/
const buscarPuerta = async (pg) => {
  const antes = await angulos(pg)
  let marcador = await sobreUnMarcador(pg, PUERTAS)
  for (let vuelta = 0; !marcador && vuelta < 12; vuelta++) {
    const desde = await sobreLaFoto(pg)
    await pg.mouse.move(desde.x, desde.y)
    await pg.mouse.down()
    // Hacia la izquierda: la cámara gira a la derecha, unos 35° por pasada.
    for (let i = 1; i <= 8; i++) {
      await pg.mouse.move(desde.x - i * 22, desde.y, { steps: 2 })
      await pg.waitForTimeout(20)
    }
    await pg.mouse.up()
    await pg.waitForTimeout(900)
    marcador = await sobreUnMarcador(pg, PUERTAS)
  }
  if (!marcador) {
    const despues = await angulos(pg)
    const inventario = await pg.evaluate(() =>
      [...document.querySelectorAll('button[style*="translate3d"]')].map((b) => {
        const r = b.getBoundingClientRect()
        return `${b.textContent.trim()}@${Math.round(r.x)},${Math.round(r.y)} ${getComputedStyle(b).visibility}`
      }),
    )
    console.log(
      `     ↑ sin puerta: yaw ${antes?.yaw}→${despues?.yaw}; marcadores: ${inventario.length ? inventario.join(' · ') : 'ninguno con transform'}`,
    )
  }
  return marcador
}

/** El nombre de la habitación que muestra la barra de arriba. */
const habitacionVisible = (pg) =>
  pg.evaluate(() => document.querySelector('p.truncate.text-xs')?.textContent?.trim() ?? '')
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

  /* ------------------------------------------------------------------------
   * ATRAVESAR LA PUERTA
   *
   * Al tocar un punto de ENLACE la cámara se empuja hacia él y vuelve al centro
   * (ver CameraRig). Tres cosas, y las tres tienen que cumplirse:
   *   1. la cámara SALE del centro: en algún momento el empuje pasa de 5;
   *   2. y VUELVE exactamente a 0, no a "casi cero" — los marcadores del HUD se
   *      proyectan asumiendo la cámara en el centro;
   *   3. y desde la barra de habitaciones NO hay empuje: ahí se salta de cuarto
   *      en cuarto, no se cruza ninguna puerta.
   * Y después de todo eso, parado, el visor tiene que volver a CERO dibujos:
   * una animación que se quedara pidiendo cuadro sería justo lo que la regla de
   * oro del proyecto prohíbe.
   * ---------------------------------------------------------------------- */
  await page.getByRole('button', { name: 'Reencuadrar' }).click()
  await page.waitForTimeout(1600)
  const puerta = await buscarPuerta(page)
  if (!puerta) {
    console.log(`  ${'atravesar la puerta'.padEnd(28)} NO SE ENCONTRÓ NINGUNA PUERTA`)
    bien = false
  } else {
    const destino = /Cocina/.test(puerta.texto) ? 'Cocina' : /Recámara/.test(puerta.texto) ? 'Recámara' : 'Sala'
    await page.mouse.click(puerta.x, puerta.y)
    const empujes = await muestrearEmpuje(page)
    await page.waitForTimeout(1200)
    const reposo = await angulos()
    const llego = (await habitacionVisible(page)).startsWith(destino)
    const pico = empujes.length ? Math.max(...empujes) : 0
    const cruza = pico > 5 && reposo?.empuje === 0 && llego
    console.log(
      `  ${'atravesar la puerta'.padEnd(28)} ${(cruza ? 'empuja y vuelve' : 'MAL').padEnd(10)} ` +
        `pico ${pico} · reposo ${reposo?.empuje} · ${empujes.length} lecturas · llegó a ${destino}: ${llego}`,
    )
    if (!cruza) bien = false

    /* Desde la barra de habitaciones, a un cuarto distinto del actual: sin empuje. */
    const otro = destino === 'Cocina' ? 'Recámara' : 'Cocina'
    await page.getByRole('button', { name: otro, exact: true }).click()
    const sinPuerta = await muestrearEmpuje(page, 1200)
    const picoBarra = sinPuerta.length ? Math.max(...sinPuerta) : null
    const quietaLaBarra = picoBarra === 0
    console.log(
      `  ${'la barra no empuja'.padEnd(28)} ${(quietaLaBarra ? 'sin empuje' : 'EMPUJÓ').padEnd(10)} ` +
        `pico ${picoBarra} · ${sinPuerta.length} lecturas`,
    )
    if (!quietaLaBarra) bien = false
  }

  await page.waitForTimeout(2500)
  const trasPuerta = await muestrear('parado tras cruzar una puerta')
  if (trasPuerta.draws > 0 || trasPuerta.raf > 0) {
    console.log('     ↑ MAL: el empuje dejó algo pidiendo cuadro')
    bien = false
  }
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
/* Los mismos dos avisos que la pestaña principal: que exista el canvas y que el
   HUD haya colocado sus marcadores (nacen con visibility:hidden hasta el primer
   pulso). Con solo dormir 3 s, en el CI la búsqueda de la puerta arrancaba antes
   de que hubiera nada que encontrar. */
await hoja.waitForSelector('canvas', { timeout: 40000 })
await hoja
  .waitForFunction(
    () => [...document.querySelectorAll('button[style*="translate3d"]')].some((b) => getComputedStyle(b).visibility === 'visible'),
    null,
    { timeout: 15000 },
  )
  .catch(() => {})
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

/* Y el empuje al cruzar una puerta es exactamente el tipo de movimiento que
   molesta a quien pidió menos: con el ajuste activo tiene que ser CERO en todas
   las lecturas, no solo más corto. La habitación tiene que cambiar igual. */
const puertaQuieta = await buscarPuerta(hoja)
if (!puertaQuieta) {
  console.log(`  ${'puerta sin empuje'.padEnd(28)} NO SE ENCONTRÓ NINGUNA PUERTA`)
  bien = false
} else {
  const antesDeCruzar = await habitacionVisible(hoja)
  await hoja.mouse.click(puertaQuieta.x, puertaQuieta.y)
  const lecturas = await muestrearEmpuje(hoja, 1400)
  await hoja.waitForTimeout(800)
  const cambio = (await habitacionVisible(hoja)) !== antesDeCruzar
  const nunca = lecturas.length > 0 && lecturas.every((v) => v === 0)
  console.log(
    `  ${'puerta sin empuje'.padEnd(28)} ${(nunca && cambio ? 'quieta, y cambia' : 'MAL').padEnd(16)} ` +
      `máximo ${lecturas.length ? Math.max(...lecturas) : 'sin lecturas'} · cambió de cuarto: ${cambio}`,
  )
  if (!(nunca && cambio)) bien = false
}

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

/* ============================================================================
 *  EL AUTOGIRO (MODO KIOSCO) Y LOS CERO DIBUJOS POR SEGUNDO
 * ============================================================================
 *
 * Autorrotar es dibujar sin parar: pelea de frente con la propiedad más valiosa
 * del visor. Por eso está apagado por defecto —lo de arriba ya midió que la demo
 * da 0 dibujos/s parada— y aquí se mide lo que pasa cuando SÍ está encendido:
 *   · gira de verdad, a la velocidad que dice el rig (6°/s, una vuelta por minuto);
 *   · un toque lo detiene y el visor vuelve a CERO dibujos mientras dura la pausa;
 *   · a los cinco segundos sigue solo (es un temporizador, no un cuadro más);
 *   · con la pestaña oculta no dibuja nada;
 *   · con "reducir movimiento" no gira, punto.
 *
 * El recorrido kiosco se arma en IndexedDB con las mismas funciones del store que
 * usa la app —no hay una ruta de prueba en el producto— y se abre por `#/ver/`. */
console.log('\n=== Autogiro: el modo kiosco ===')
const kiosco = await ctx.newPage()
kiosco.on('pageerror', (e) => errores.push(e.message))
await kiosco.goto(BASE + '#/inicio', { waitUntil: 'networkidle' })
const idKiosco = await kiosco.evaluate(async () => {
  const tours = await import('/src/lib/store/tours.ts')
  const foto = await (await fetch('/panoramas/sala.jpg')).blob()
  const tour = tours.createTour('Kiosco')
  const scene = tours.createScene({ id: 'sala', name: 'Sala', imageId: 'img-kiosco-sala' })
  const guardado = await tours.guardarEscenaConFoto({ tour: { ...tour, autogiro: true }, scene, foto })
  return guardado.id
})
await kiosco.goto(BASE + '#/ver/' + idKiosco, { waitUntil: 'domcontentloaded' })
await kiosco.waitForSelector('canvas', { timeout: 40000 })
await kiosco.waitForTimeout(4000)

const muestrearEn = async (pg, etiqueta, ms) => {
  await pg.evaluate(() => window.__RESET())
  await pg.waitForTimeout(ms)
  const s = await pg.evaluate(() => ({ ...window.__PERF }))
  const draws = Math.round(s.draws / (ms / 1000))
  console.log(`  ${etiqueta.padEnd(28)} ${String(draws).padStart(3)} dibujos/s`)
  return draws
}
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180

const girando = await muestrearEn(kiosco, 'kiosco: girando solo', 2000)
const y0 = (await angulos(kiosco))?.yaw
await kiosco.waitForTimeout(2000)
const y1 = (await angulos(kiosco))?.yaw
const avanzo = y0 !== undefined && y1 !== undefined ? wrap180(y1 - y0) : NaN
/* 6°/s por 2 s son 12°. El margen cubre el muestreo del badge (que pinta por
   pulso, no por cuadro) y algún cuadro largo; no cubre ni el doble ni la mitad. */
const velocidadOk = avanzo >= 9 && avanzo <= 15
console.log(`  ${'kiosco: avanza'.padEnd(28)} ${avanzo.toFixed(1)}° en 2 s ${velocidadOk ? '' : '← MAL: se esperaban ~12°'}`)
if (girando === 0 || !velocidadOk) bien = false

/* Un toque —sin arrastre— lo detiene. Se espera a que la cámara se asiente y se
   mide dentro de la pausa: tiene que ser CERO, no "poco". */
const puntoKiosco = await sobreLaFoto(kiosco)
const toque = Date.now()
await kiosco.mouse.click(puntoKiosco.x, puntoKiosco.y)
await kiosco.waitForTimeout(1200)
const enPausa = await muestrearEn(kiosco, 'kiosco: tocado, en pausa', 2500)
if (enPausa > 0) {
  console.log('     ↑ MAL: tocado tiene que quedarse en cero mientras dura la pausa')
  bien = false
}
/* Y a los cinco segundos del toque sigue solo. Nadie ha pedido cuadro desde
   entonces: si vuelve a girar es porque el despertador del rig tocó el timbre. */
const faltan = 5000 + 700 - (Date.now() - toque)
if (faltan > 0) await kiosco.waitForTimeout(faltan)
const retomo = await muestrearEn(kiosco, 'kiosco: sigue solo a los 5 s', 2000)
if (retomo === 0) {
  console.log('     ↑ MAL: terminada la pausa tenía que volver a girar')
  bien = false
}

/* Pestaña oculta. Chromium headless no se puede "ocultar", así que se finge lo
   que el rig lee —`document.visibilityState`— y se avisa con el evento real. */
await kiosco.evaluate(() => {
  Object.defineProperty(Document.prototype, 'visibilityState', {
    configurable: true,
    get: () => window.__vis ?? 'visible',
  })
  window.__vis = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
})
await kiosco.waitForTimeout(600)
const oculto = await muestrearEn(kiosco, 'kiosco: pestaña oculta', 2000)
if (oculto > 0) {
  console.log('     ↑ MAL: oculto no debería dibujarse nada')
  bien = false
}
await kiosco.evaluate(() => {
  window.__vis = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
})
await kiosco.waitForTimeout(600)
const deVuelta = await muestrearEn(kiosco, 'kiosco: vuelve a verse', 1500)
if (deVuelta === 0) {
  console.log('     ↑ MAL: al volver a verse tenía que retomar')
  bien = false
}

/* Y con "reducir movimiento" no gira, sin excepción. El ajuste se cambia con la
   pestaña abierta, como en iOS (Ajustes → Accesibilidad → Movimiento). */
await kiosco.emulateMedia({ reducedMotion: 'reduce' })
await kiosco.waitForTimeout(600)
const menos = await muestrearEn(kiosco, 'kiosco: menos movimiento', 2000)
if (menos > 0) {
  console.log('     ↑ MAL: con "reducir movimiento" el autogiro no debe girar')
  bien = false
}
await kiosco.close()

console.log(`\n${bien ? 'TODO BIEN' : 'HAY ALGO MAL'}`)
console.log('errores de consola:', errores.length ? errores : 'ninguno')
await browser.close()
process.exit(bien && errores.length === 0 ? 0 : 1)

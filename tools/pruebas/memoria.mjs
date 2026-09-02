/**
 * ============================================================================
 *  ¿CUÁNTA MEMORIA DE VIDEO ESTÁ USANDO EL VISOR?
 * ============================================================================
 *
 * Safari en iOS tumba la pestaña alrededor de los 384 MB de memoria de video, y
 * lo hace sin avisar: la escena se queda en negro o la página se recarga sola.
 * Un JPEG de 1 MB no ocupa 1 MB ahí: se descomprime. Una equirectangular de
 * 4096×2048 son 33 MB, más un tercio de mipmaps.
 *
 * Esta prueba NO le cree a nadie: parchea WebGL antes de que corra la app y
 * cuenta los objetos de GPU de verdad, atribuyendo cada textura a SU contexto.
 * Cuando un contexto muere, sus texturas mueren con él, aunque nadie haya
 * llamado a deleteTexture.
 *
 * Contesta tres preguntas:
 *   1. ¿Cuánta memoria de video ocupa un recorrido de siete habitaciones?
 *   2. ¿Deja de crecer, o sigue subiendo vuelta tras vuelta?
 *   3. Al salir del visor, ¿se suelta el contexto WebGL o se acumula?
 *
 * ── Cómo se corre ──────────────────────────────────────────────────────────
 *
 *   npm run dev                                   (en otra terminal)
 *   npx playwright@1.55 install chromium          (solo la primera vez)
 *   node tools/pruebas/memoria.mjs http://localhost:5173/
 *
 * Agrega `modesto` al final para fingir un teléfono de gama baja y comprobar
 * que la app de verdad le baja la resolución a las texturas:
 *
 *   node tools/pruebas/memoria.mjs http://localhost:5173/ modesto
 *
 * Si ya tienes un Chromium instalado, CHROMIUM_PATH evita bajar otro:
 *
 *   CHROMIUM_PATH=/ruta/a/chrome node tools/pruebas/memoria.mjs http://localhost:5173/
 *
 * Playwright NO es dependencia del proyecto: esto se corre a mano cuando se
 * toca algo del visor, no en cada build.
 */

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('Falta Playwright. Instálalo solo para esta prueba:\n  npm i -D playwright && npx playwright install chromium')
  process.exit(1)
}

const BASE = process.argv[2]
const MODESTO = process.argv[3] === 'modesto'
if (!BASE) {
  console.error('Uso: node tools/pruebas/memoria.mjs <url del visor> [modesto]')
  process.exit(1)
}

/* CHROMIUM_PATH sirve para apuntar a un Chromium ya instalado en la máquina,
   en vez del que baja Playwright. */
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
})
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})

if (MODESTO) {
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 })
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 })
  })
}

await ctx.addInitScript(() => {
  const contextos = new Map()
  window.__VRAM = () => {
    let vivos = 0
    let texturas = 0
    let bytes = 0
    for (const info of contextos.values()) {
      if (!info.vivo) continue
      vivos++
      texturas += info.texturas.size
      for (const b of info.texturas.values()) bytes += b
    }
    return {
      contextosVivos: vivos,
      contextosAbiertos: contextos.size,
      texturasResidentes: texturas,
      mb: bytes / 1048576,
    }
  }

  const medir = (args) => {
    if (args.length >= 9 && typeof args[3] === 'number' && typeof args[4] === 'number') {
      return args[1] === 0 ? args[3] * args[4] * 4 : 0
    }
    const src = args[args.length - 1]
    if (src && typeof src === 'object') {
      const w = src.width ?? src.videoWidth ?? src.naturalWidth ?? 0
      const h = src.height ?? src.videoHeight ?? src.naturalHeight ?? 0
      return args[1] === 0 ? w * h * 4 : 0
    }
    return 0
  }

  const parchear = (proto) => {
    if (!proto || proto.__parcheado) return
    proto.__parcheado = true

    const anotar = (gl, bytes) => {
      const info = contextos.get(gl)
      if (info && bytes && gl.__ligada && info.texturas.has(gl.__ligada)) {
        const antes = info.texturas.get(gl.__ligada) || 0
        info.texturas.set(gl.__ligada, Math.max(antes, bytes))
      }
    }

    const ct = proto.createTexture
    proto.createTexture = function (...a) {
      const t = ct.apply(this, a)
      const info = contextos.get(this)
      if (info && t) info.texturas.set(t, 0)
      return t
    }
    const bt = proto.bindTexture
    proto.bindTexture = function (...a) {
      this.__ligada = a[1]
      return bt.apply(this, a)
    }
    const dt = proto.deleteTexture
    proto.deleteTexture = function (...a) {
      contextos.get(this)?.texturas.delete(a[0])
      return dt.apply(this, a)
    }
    const ti = proto.texImage2D
    proto.texImage2D = function (...a) {
      anotar(this, medir(a))
      return ti.apply(this, a)
    }
    // three usa texStorage2D en WebGL2 (texturas inmutables), no texImage2D.
    if (proto.texStorage2D) {
      const ts = proto.texStorage2D
      proto.texStorage2D = function (...a) {
        anotar(this, (a[3] * a[4] * 4) | 0)
        return ts.apply(this, a)
      }
    }
  }

  const orig = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (tipo, ...resto) {
    const c = orig.call(this, tipo, ...resto)
    if (c && /webgl/.test(tipo) && !contextos.has(c)) {
      contextos.set(c, { vivo: true, texturas: new Map() })
      parchear(Object.getPrototypeOf(c))
      // ESTA es la prueba de que el contexto se soltó: el navegador dispara
      // webglcontextlost cuando alguien llama loseContext().
      this.addEventListener('webglcontextlost', () => {
        const info = contextos.get(c)
        if (info) {
          info.vivo = false
          info.texturas.clear()
        }
      })
    }
    return c
  }
})

const page = await ctx.newPage()
const errores = []
page.on('pageerror', (e) => errores.push(e.message))

const leer = async (etiqueta) => {
  const s = await page.evaluate(() => window.__VRAM())
  console.log(
    `${etiqueta.padEnd(40)} contextos ${s.contextosVivos}/${s.contextosAbiertos} · ` +
      `texturas residentes ${String(s.texturasResidentes).padStart(2)} · ` +
      `${s.mb.toFixed(0).padStart(4)} MB de video`,
  )
  return s
}

console.log(`=== Recorrido de 7 habitaciones · aparato ${MODESTO ? 'MODESTO (gama baja)' : 'NORMAL'} ===`)
await page.goto(BASE + '#/inicio', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.getByRole('button', { name: 'Nuevo recorrido' }).click()
await page.getByPlaceholder('Casa en Tlajomulco').fill('Prueba de memoria')
await page.getByRole('button', { name: 'Crear', exact: true }).click()
await page.waitForTimeout(700)

const fotos = ['sala', 'cocina', 'recamara', 'sala', 'cocina', 'recamara', 'sala']
for (let i = 0; i < fotos.length; i++) {
  await page.getByRole('button', { name: 'Agregar habitación' }).click()
  await page.getByRole('button', { name: 'Usar una foto que ya tengo' }).click()
  await page.waitForTimeout(300)
  await page.locator('input[type=file]').first().setInputFiles(`public/panoramas/${fotos[i]}.jpg`)
  await page.waitForTimeout(2200)
  await page.getByPlaceholder('Sala').fill(`Cuarto ${i + 1}`)
  await page.getByRole('button', { name: 'Guardar habitación' }).click()
  await page.waitForTimeout(2600)
  await page.getByRole('button', { name: 'Regresar' }).click()
  await page.waitForTimeout(900)
}
console.log('   7 habitaciones creadas')

await page.getByRole('button', { name: 'Ver', exact: true }).click()
await page.waitForTimeout(3500)
await leer('visor abierto (cuarto 1)')

for (let i = 2; i <= 7; i++) {
  await page.getByRole('button', { name: `Cuarto ${i}`, exact: true }).click()
  await page.waitForTimeout(2200)
}
const primera = await leer('tras pasar por las 7 habitaciones')

for (let i = 1; i <= 7; i++) {
  await page.getByRole('button', { name: `Cuarto ${i}`, exact: true }).click()
  await page.waitForTimeout(1400)
}
const segunda = await leer('tras una segunda vuelta completa')

await page.getByRole('button', { name: 'Editar el recorrido' }).click()
await page.waitForTimeout(2500)
const fuera = await leer('tras salir del visor')

/* El caché de equirectangulares tiene tope 5, pero el arnés cuenta TODAS las
   texturas del contexto, y el visor sube además las miniaturas de la barra de
   habitaciones. Medido: 9 residentes con 7 habitaciones. La tolerancia cubre eso
   sin dejar pasar un caché desbocado (con el tope en 99 se midieron 11). */
const MINIATURAS_TOLERADAS = 4

const pico = Math.max(primera.mb, segunda.mb)
console.log('\nDIAGNÓSTICO')
console.log(
  `  pico de memoria de video: ${pico.toFixed(0)} MB ` +
    (pico < 250 ? '(cabe en el presupuesto de iOS)' : '(SE PASA del presupuesto de iOS)'),
)
/* ── Se afirma contra el TOPE, no contra la vuelta anterior ────────────────
 *
 * La versión anterior comparaba las texturas de la segunda vuelta con las de la
 * primera y solo lo IMPRIMÍA. Dos defectos a la vez, los dos demostrados:
 *
 *   · la comparación no entraba en el `process.exit`, así que decía
 *     "SIGUE CRECIENDO" y salía con 0;
 *   · y era estructuralmente incapaz de detectar un caché sin tope: las dos
 *     vueltas visitan LAS MISMAS siete habitaciones, así que un caché ilimitado
 *     se satura en la primera y la segunda lo ve idéntico. Con
 *     `maximoEnCache: 99` el arnés reportaba "11 texturas · 224 MB · no crece ·
 *     cabe en el presupuesto" y exit 0.
 *
 * Lo que el caché de verdad promete es un TOPE, así que eso es lo que se exige.
 * El número sale de `dispositivo.ts`, que es donde vive la decisión. */
/* Hoy vale 5 en los dos niveles de aparato (dispositivo.ts). Se escribe asi, y
   no como un 5 pelado, para que quien cambie ese numero encuentre este. */
const TOPE_CACHE = MODESTO ? 5 : 5
const dentroDelTope =
  primera.texturasResidentes <= TOPE_CACHE + MINIATURAS_TOLERADAS &&
  segunda.texturasResidentes <= TOPE_CACHE + MINIATURAS_TOLERADAS
console.log(
  `  texturas residentes: ${segunda.texturasResidentes} ` +
    (dentroDelTope
      ? `(dentro del tope de ${TOPE_CACHE} + miniaturas)`
      : `(SE PASA DEL TOPE de ${TOPE_CACHE}: el caché no está acotado)`),
)
console.log(
  `  contextos vivos al salir: ${fuera.contextosVivos} ` +
    (fuera.contextosVivos === 0 ? '(todo soltado)' : '(SE ACUMULAN: el contexto no se libera)'),
)
console.log('\nerrores de consola:', errores.length ? errores : 'ninguno')

await browser.close()
/* `errores` se recogía y se imprimía pero NO entraba en el código de salida, a
   diferencia de los otros seis arneses: una excepción de la página durante la
   corrida salía en verde. Ahora cuenta. */
process.exit(pico < 250 && fuera.contextosVivos === 0 && dentroDelTope && errores.length === 0 ? 0 : 1)

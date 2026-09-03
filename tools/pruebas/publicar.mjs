/**
 * ============================================================================
 *  PUBLICAR POR LINK, DE PUNTA A PUNTA
 * ============================================================================
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/pruebas/publicar.mjs
 *
 * Es la única prueba que demuestra que una casa DEJÓ DE VIVIR EN UN SOLO
 * TELÉFONO: se publica desde un navegador y se abre en otro que no tiene nada
 * guardado —IndexedDB vacío, como el del comprador al que le llegó el link—.
 * Todo lo demás del proyecto se puede probar con un `#/ver/<id>`; esto no.
 *
 * ── Qué levanta ─────────────────────────────────────────────────────────────
 *
 * No recibe URL: levanta lo suyo. El Worker de verdad (`worker/`) con
 * `wrangler dev`, que corre el mismo código que Cloudflare con un R2 en disco,
 * y un SEGUNDO servidor del visor compilado con `VITE_PUBLICAR_BASE` apuntando a
 * ese Worker —el de `npm run dev` de los otros arneses no la tiene, y sin ella el
 * botón de publicar no existe—. Los dos se apagan al terminar.
 *
 * ── Qué mide ────────────────────────────────────────────────────────────────
 *
 *   · publicar por la interfaz, con la clave, y recibir un link con llave;
 *   · la tarjeta de WhatsApp (`/t/<llave>`) lleva el precio, la dirección y la
 *     inmobiliaria: es un anuncio, no un nombre de archivo;
 *   · el manifiesto es la v2: ficha, marca con su logo como archivo, kiosco,
 *     rumbo y nivel por habitación, y la variante de 2048 de cada foto;
 *   · en un navegador LIMPIO el link abre en la portada, con la marca puesta
 *     (medido en píxeles), y al entrar la foto se dibuja —el "cuarto negro" por
 *     CORS es el fallo número uno de esta capa y no da ningún error—;
 *   · un aparato normal baja la foto completa; uno modesto, la de 2048;
 *   · editar después de publicar avisa "hay cambios sin publicar"; volver a
 *     subir conserva el MISMO link y el aviso se va;
 *   · quitar de internet borra manifiesto y fotos y el comprador lo ve;
 *   · y lo que el Worker rechaza: sin clave, un nombre de archivo fuera de la
 *     forma, un `logo.png` que no es PNG.
 *
 * Regla de la casa, como en los demás: se importa lo REAL (el fixture v2 con su
 * basura adentro, el Worker de verdad), no una copia.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { tourito } from './zipito.mjs'

const PUERTO_WORKER = Number(process.env.PUERTO_WORKER ?? 8788)
const PUERTO_VISOR = Number(process.env.PUERTO_VISOR ?? 5174)
const WORKER = `http://localhost:${PUERTO_WORKER}`
const VISOR = `http://localhost:${PUERTO_VISOR}/`
const CLAVE = 'clave-de-prueba'
const LLAVE = /^[abcdefghijkmnpqrstuvwxyz23456789]{26}$/

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('Falta Playwright:  npm i -D playwright && npx playwright install chromium')
  process.exit(1)
}

/* ── Los dos servidores ──────────────────────────────────────────────────── */

const hijos = []
function lanzar(nombre, cmd, args, opciones = {}) {
  const p = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    ...opciones,
    env: { ...process.env, ...(opciones.env ?? {}) },
  })
  let log = ''
  p.stdout.on('data', (d) => (log += d))
  p.stderr.on('data', (d) => (log += d))
  hijos.push({ nombre, p, log: () => log })
  return p
}

function apagar() {
  for (const { p } of hijos) {
    try {
      // El grupo entero: wrangler lanza workerd aparte y vite sus workers.
      process.kill(-p.pid, 'SIGTERM')
    } catch {
      try {
        p.kill('SIGTERM')
      } catch {
        /* ya no estaba */
      }
    }
  }
}
process.on('exit', apagar)
process.on('SIGINT', () => process.exit(130))

async function esperar(url, ms = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url)
      if (r.status < 500) return true
    } catch {
      /* todavía no */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const estado = mkdtempSync(join(tmpdir(), 'visor-r2-'))
lanzar(
  'wrangler',
  'npx',
  [
    'wrangler', 'dev',
    '--port', String(PUERTO_WORKER),
    '--var', `CLAVE_PUBLICACION:${CLAVE}`,
    '--var', `APP_BASE:${VISOR}`,
    '--persist-to', estado,
    '--show-interactive-dev-session=false',
  ],
  { cwd: 'worker', env: { WRANGLER_SEND_METRICS: 'false', CI: '1' } },
)
lanzar('vite', 'npx', ['vite', '--port', String(PUERTO_VISOR), '--strictPort'], {
  env: { VITE_PUBLICAR_BASE: WORKER },
})

console.log('=== Levantando el Worker local y el visor compilado con su dirección ===')
const arranco = (await Promise.all([esperar(`${WORKER}/robots.txt`), esperar(VISOR)])).every(Boolean)
if (!arranco) {
  for (const h of hijos) console.error(`\n--- ${h.nombre} ---\n${h.log().slice(-3000)}`)
  console.error('No arrancaron los servidores.')
  process.exit(1)
}
console.log(`  Worker en ${WORKER} · visor en ${VISOR}`)

/* ── El navegador ────────────────────────────────────────────────────────── */

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const movil = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }

let bien = true
const revisar = (nombre, ok, detalle = '') => {
  console.log(`  ${nombre.padEnd(58)} ${(ok ? 'sí' : 'NO').padEnd(4)} ${detalle}`)
  if (!ok) bien = false
}
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const conErrores = (page) => {
  const errores = []
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text())
  })
  page.on('pageerror', (e) => errores.push(String(e)))
  return errores
}

/** El brillo medio de una zona de la pantalla, para saber si la foto se pintó. */
const brilloDe = async (page) => {
  const png = await page.screenshot({ clip: { x: 60, y: 350, width: 260, height: 200 } })
  return page.evaluate(async (datos) => {
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
}

/**
 * Espera a que la tarjeta de publicar enseñe `listo`, o a que enseñe un error:
 * lo que llegue primero. Si es el error, se lanza CON su texto, que es lo que
 * hay que leer; un TimeoutError de 120 s no dice nada.
 */
const esperarPublicacion = async (page, listo) => {
  const fallo = page.locator('p.text-red-300')
  await Promise.race([
    listo.waitFor({ timeout: 120000 }),
    fallo.waitFor({ timeout: 120000 }).then(async () => {
      throw new Error(`publicar falló en la interfaz: ${(await fallo.textContent())?.trim()}`)
    }),
  ])
}

const fotosBajadas = (page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((r) => r.name)
      .filter((n) => /\/fotos\//.test(n))
      .map((n) => n.split('/fotos/')[1]),
  )

try {
/* ══════════════════════════════════════════════════════════════════════════
 * 1 · EL AGENTE PUBLICA
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== El agente publica la casa por la interfaz ===')

const agente = await browser.newContext(movil)
const pg = await agente.newPage()
const erroresAgente = conErrores(pg)

await pg.goto(`${VISOR}#/inicio`, { waitUntil: 'networkidle' })
await pg.waitForTimeout(1200)

/* El mismo fixture v2 de `formato.mjs`, con su basura adentro: lo que llegue al
   servidor tiene que ser lo que el importador dejó pasar, no lo del archivo. */
const SALA = readFileSync('public/panoramas/sala.jpg')
const manifiestoV2 = JSON.parse(readFileSync('tools/pruebas/fixtures/v2.json', 'utf8'))
await pg.setInputFiles('input[type=file]', {
  name: 'v2.tour',
  mimeType: 'application/zip',
  buffer: tourito(manifiestoV2, [{ name: 'fotos/sala.jpg', data: SALA }]),
})
await pg.waitForTimeout(3500)
const hash = await pg.evaluate(() => location.hash)
const id = /^#\/ver\/(.+)$/.exec(hash)?.[1]
revisar('el .tour v2 se importa', !!id, hash)

/* Un logo, para que viaje: el del fixture es un `logoId` de otro teléfono y se
   ignora al importar (formato.mjs lo prueba). */
await pg.evaluate(async (id) => {
  const tours = await import('/src/lib/store/tours.ts')
  const png = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  )
  const logoId = await tours.putImage(new Blob([png], { type: 'image/png' }))
  const tour = await tours.getTour(id)
  await tours.saveTour({ ...tour, marca: { ...tour.marca, logoId } })
}, id)

await pg.goto(`${VISOR}#/editar/${id}`, { waitUntil: 'networkidle' })
await pg.waitForTimeout(1200)
const botonPublicar = pg.getByRole('button', { name: 'Publicar y obtener el link' })
revisar('el editor ofrece publicar (VITE_PUBLICAR_BASE está puesta)', await botonPublicar.isVisible())

await botonPublicar.click()
await pg.getByLabel('Código', { exact: true }).fill(CLAVE)
await pg.getByRole('button', { name: 'Guardar y publicar' }).click()

const patronLink = new RegExp(`^${escapar(WORKER)}/t/[a-z2-9]{26}$`)
await esperarPublicacion(pg, pg.getByText(patronLink))
const link = (await pg.getByText(patronLink).textContent()).trim()
const llave = link.split('/t/')[1]
revisar('publicar devuelve un link con llave', LLAVE.test(llave), link)
revisar('y dice que el link está al día', await pg.getByText(/El link está al día/).isVisible())

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · LO QUE QUEDÓ EN EL SERVIDOR
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== Lo que quedó en el servidor ===')

const og = await (await fetch(`${WORKER}/t/${llave}`)).text()
revisar(
  'la tarjeta de WhatsApp lleva el precio en el título',
  og.includes('og:title" content="Desde $1.9M · Casa de prueba v2"'),
  /og:title" content="([^"]*)"/.exec(og)?.[1] ?? '',
)
revisar('la dirección como descripción', og.includes('og:description" content="Av. Vallarta 1234, Zapopan"'))
revisar('la inmobiliaria como sitio', og.includes('og:site_name" content="Inmobiliaria del Valle"'))
revisar('y rebota al visor con la llave', og.includes(`#/p/${llave}`))

const manifiesto = await (await fetch(`${WORKER}/t/${llave}/tour.json`)).json()
revisar('el manifiesto es la versión 2', manifiesto.version === 2)
revisar(
  'con la ficha, la tinta del HUD y el kiosco',
  manifiesto.ficha?.precio === 'Desde $1.9M' && manifiesto.marca?.hudTinta === '#f8fafc' && manifiesto.autogiro === true,
  JSON.stringify([manifiesto.ficha?.precio, manifiesto.marca?.hudTinta, manifiesto.autogiro]),
)
revisar(
  'la inyección de CSS del archivo no llegó al servidor',
  manifiesto.marca?.colores?.ink50 === undefined,
  String(manifiesto.marca?.colores?.ink50),
)
revisar('el logo viaja como archivo', manifiesto.marca?.logo === 'logo.png', String(manifiesto.marca?.logo))
const logoResp = await fetch(`${WORKER}/t/${llave}/fotos/logo.png`)
revisar(
  'y se sirve como PNG',
  logoResp.status === 200 && (logoResp.headers.get('content-type') ?? '').includes('image/png'),
  `${logoResp.status} ${logoResp.headers.get('content-type')}`,
)
revisar(
  'cada habitación trae su variante de 2048',
  manifiesto.scenes.length === 2 &&
    manifiesto.scenes.every((e, i) => e.foto2048 === `${String(i).padStart(3, '0')}.2k.jpg`),
  JSON.stringify(manifiesto.scenes.map((e) => e.foto2048)),
)
const sala = manifiesto.scenes.find((e) => e.name === 'Sala')
const patio = manifiesto.scenes.find((e) => e.name === 'Patio')
revisar(
  'y su rumbo y nivel, ya saneados por el importador',
  sala?.rumbo === 70 && sala?.nivel?.tiltX === 2 && patio?.rumbo === 40 && patio?.nivel?.tiltZ === 15,
  JSON.stringify([sala?.rumbo, sala?.nivel, patio?.rumbo, patio?.nivel]),
)

/* La variante se mide desde NODE, leyendo la cabecera SOF del JPEG, y no con un
   `fetch` desde la página: el arnés no debe depender del CORS del Worker para
   MEDIR. Eso se prueba aparte, más abajo, en el navegador del comprador —y si
   se midiera aquí en la página, un Worker sin CORS tumbaría el arnés en esta
   línea en vez de en la aserción del cuarto negro, que es la que lo nombra. */
const dimensionesJpeg = (b) => {
  let i = 2
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marcador = b[i + 1]
    if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd8)) {
      i += 2
      continue
    }
    const largo = b.readUInt16BE(i + 2)
    const esSof = marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc
    if (esSof) return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) }
    i += 2 + largo
  }
  return { ancho: 0, alto: 0 }
}
const chica = Buffer.from(await (await fetch(`${WORKER}/t/${llave}/fotos/000.2k.jpg`)).arrayBuffer())
const variante = { ...dimensionesJpeg(chica), bytes: chica.length }
const pesoCompleta = Number((await fetch(`${WORKER}/t/${llave}/fotos/000.jpg`, { method: 'HEAD' })).headers.get('content-length'))
revisar('la variante mide 2048×1024', variante.ancho === 2048 && variante.alto === 1024, `${variante.ancho}×${variante.alto}`)
revisar(
  'y pesa bastante menos que la completa',
  variante.bytes > 0 && variante.bytes < pesoCompleta * 0.75,
  `${variante.bytes} B contra ${pesoCompleta} B`,
)

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · EL COMPRADOR ABRE EL LINK EN UN NAVEGADOR LIMPIO
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== El comprador abre el link en un navegador sin nada guardado ===')

const comprador = await browser.newContext(movil)
const pc = await comprador.newPage()
const erroresComprador = conErrores(pc)

await pc.goto(`${VISOR}#/p/${llave}`, { waitUntil: 'networkidle' })
await pc.waitForTimeout(2500)
revisar(
  'no tiene ningún recorrido guardado',
  await pc.evaluate(async () => {
    const tours = await import('/src/lib/store/tours.ts')
    return (await tours.listTours()).length === 0
  }),
)
revisar('el link abre en la PORTADA, con el precio', await pc.getByText('Desde $1.9M').isVisible())
revisar('sin WebGL todavía', await pc.evaluate(() => document.querySelectorAll('canvas').length === 0))
const tintaHud = await pc.evaluate(() => {
  const el = document.querySelector('.text-hud')
  return el ? getComputedStyle(el).color : null
})
revisar('con la marca puesta: la tinta del HUD es la del archivo', tintaHud === 'rgb(248, 250, 252)', String(tintaHud))
const acento = await pc.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-brand-500').trim())
revisar('y el acento de la inmobiliaria', acento === '#7c3aed', acento)
revisar('y su logo', (await pc.locator('img[src$="/fotos/logo.png"]').count()) === 1)

await pc.getByRole('button', { name: /Ver el recorrido/ }).click()
await pc.waitForTimeout(5000)
revisar('al entrar aparece el visor 3D', await pc.evaluate(() => document.querySelectorAll('canvas').length > 0))
const brillo = await brilloDe(pc)
revisar('y la foto se dibuja: no es un cuarto negro por CORS', brillo > 40, `brillo ${brillo}`)
const bajadasNormal = await fotosBajadas(pc)
revisar(
  'un aparato normal baja las fotos completas, no la variante',
  bajadasNormal.some((n) => /^00[01]\.jpg$/.test(n)) && !bajadasNormal.some((n) => /\.2k\.jpg$/.test(n)),
  bajadasNormal.join(' '),
)
revisar('sin errores de consola en el comprador', erroresComprador.length === 0, erroresComprador.join(' | '))

/* ── El mismo link en un aparato modesto ──────────────────────────────────── */
const modesto = await browser.newContext(movil)
await modesto.addInitScript(() => {
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 })
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 })
})
const pm = await modesto.newPage()
await pm.goto(`${VISOR}#/p/${llave}`, { waitUntil: 'networkidle' })
await pm.waitForTimeout(2000)
await pm.getByRole('button', { name: /Ver el recorrido/ }).click()
await pm.waitForTimeout(5000)
const bajadasModesto = await fotosBajadas(pm)
revisar(
  'un aparato modesto baja la variante de 2048 y NO la completa',
  bajadasModesto.some((n) => /\.2k\.jpg$/.test(n)) && !bajadasModesto.some((n) => /^00[01]\.jpg$/.test(n)),
  bajadasModesto.join(' '),
)
revisar('y también dibuja', (await brilloDe(pm)) > 40)
await modesto.close()

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · EDITAR DESPUÉS DE PUBLICAR, Y VOLVER A SUBIR SOBRE EL MISMO LINK
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== Editar después de publicar ===')

/* Una edición del CONTENIDO por el camino normal de guardado (mueve `updatedAt`),
   como la que hace cualquier hoja del editor. */
await pg.evaluate(async (id) => {
  const tours = await import('/src/lib/store/tours.ts')
  const tour = await tours.getTour(id)
  await tours.saveTour({ ...tour, title: 'Casa renombrada' })
}, id)
await pg.reload({ waitUntil: 'networkidle' })
await pg.waitForTimeout(1200)
revisar('avisa "hay cambios sin publicar"', await pg.getByText('Hay cambios sin publicar').isVisible())

await pg.getByRole('button', { name: 'Volver a subir con los cambios' }).click()
await esperarPublicacion(pg, pg.getByText(/El link está al día/))
const link2 = (await pg.getByText(patronLink).textContent()).trim()
revisar('volver a subir conserva el MISMO link', link2 === link, `${link} → ${link2}`)
const manifiesto2 = await (await fetch(`${WORKER}/t/${llave}/tour.json`)).json()
revisar('y el link enseña la casa nueva', manifiesto2.title === 'Casa renombrada', manifiesto2.title)
revisar('y el aviso se fue', !(await pg.getByText('Hay cambios sin publicar').isVisible()))
revisar('sin errores de consola en el agente', erroresAgente.length === 0, erroresAgente.join(' | '))

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · QUITAR DE INTERNET
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== Quitar de internet ===')

await pg.getByRole('button', { name: 'Quitar de internet' }).click()
await pg.getByRole('button', { name: 'Publicar y obtener el link' }).waitFor({ timeout: 30000 })
revisar('el manifiesto deja de existir', (await fetch(`${WORKER}/t/${llave}/tour.json`)).status === 404)
revisar('y las fotos también', (await fetch(`${WORKER}/t/${llave}/fotos/000.jpg`)).status === 404)
/* `reload` y no `goto`: el comprador ya está en `#/p/<llave>`, y navegar a la
   misma dirección con el mismo hash no recarga nada. */
await pc.reload({ waitUntil: 'networkidle' })
await pc.waitForTimeout(2500)
revisar('y el comprador ve que ya no está disponible', await pc.getByText(/ya no está disponible/).isVisible())

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · LO QUE EL WORKER RECHAZA
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== Lo que el Worker rechaza ===')

const sinClave = await fetch(`${WORKER}/api/nuevo`, { method: 'POST', headers: { Authorization: 'Bearer otra' } })
revisar('sin la clave no se publica', sinClave.status === 401, String(sinClave.status))
const conClave = { Authorization: `Bearer ${CLAVE}` }
const { llave: llave2 } = await (await fetch(`${WORKER}/api/nuevo`, { method: 'POST', headers: conClave })).json()
const malNombre = await fetch(`${WORKER}/api/subir/${llave2}/evil.jpg`, {
  method: 'PUT',
  headers: conClave,
  body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
})
revisar('un nombre de archivo fuera de la forma se rechaza', malNombre.status === 400, String(malNombre.status))
const logoFalso = await fetch(`${WORKER}/api/subir/${llave2}/logo.png`, {
  method: 'PUT',
  headers: conClave,
  body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]),
})
revisar('un logo.png que es un JPEG se rechaza', logoFalso.status === 400, String(logoFalso.status))
const fotoFalsa = await fetch(`${WORKER}/api/subir/${llave2}/000.jpg`, {
  method: 'PUT',
  headers: conClave,
  body: Buffer.from('hola, no soy una foto'),
})
revisar('una foto que no es imagen se rechaza', fotoFalsa.status === 400, String(fotoFalsa.status))
const sinFotos = await fetch(`${WORKER}/api/publicar/${llave2}`, {
  method: 'PUT',
  headers: { ...conClave, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'x', startSceneId: 'a', scenes: [{ id: 'a', name: 'a', foto: '000.jpg', hotspots: [] }] }),
})
revisar('un manifiesto cuyas fotos no se subieron no se enciende', sinFotos.status === 409, String(sinFotos.status))

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · CÓDIGOS DE INVITACIÓN, CÓDIGO DE RESCATE Y CUOTAS
 *
 * Tres identificadores y ninguno es un login: la clave maestra crea códigos;
 * una inmobiliaria publica con el suyo y todo cuenta contra sus cuotas; cada
 * casa recibe un código de rescate que solo vive en el teléfono que publicó.
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== Códigos de invitación: una inmobiliaria publica con el suyo ===')

const maestra = { Authorization: `Bearer ${CLAVE}`, 'Content-Type': 'application/json' }

/* La clave maestra crea un código con cuotas chicas a propósito: UNA casa al
   día, para poder chocar con la cuota aquí mismo. */
const creado = await (
  await fetch(`${WORKER}/api/codigos`, {
    method: 'POST',
    headers: maestra,
    body: JSON.stringify({ nombre: 'Inmobiliaria de prueba', cuotas: { bytes: 40 * 1024 * 1024, recorridosPorDia: 1 } }),
  })
).json()
revisar('la clave maestra crea un código', LLAVE.test(creado.codigo ?? ''), JSON.stringify({ ...creado, codigo: '…' }))
revisar(
  'un código no crea códigos',
  (await fetch(`${WORKER}/api/codigos`, { method: 'POST', headers: { Authorization: `Bearer ${creado.codigo}` }, body: '{}' })).status === 403,
)
const listado = await (await fetch(`${WORKER}/api/codigos`, { headers: maestra })).json()
revisar(
  'y aparece en la lista, sin el código en claro',
  Array.isArray(listado) &&
    listado.some((c) => c.nombre === 'Inmobiliaria de prueba') &&
    !JSON.stringify(listado).includes(creado.codigo),
)

/* Otro teléfono, de esa inmobiliaria. */
const inmobiliaria = await browser.newContext(movil)
const pi = await inmobiliaria.newPage()
const erroresInmo = conErrores(pi)
await pi.goto(`${VISOR}#/inicio`, { waitUntil: 'networkidle' })
await pi.waitForTimeout(1200)
await pi.setInputFiles('input[type=file]', {
  name: 'v2.tour',
  mimeType: 'application/zip',
  buffer: tourito(manifiestoV2, [{ name: 'fotos/sala.jpg', data: SALA }]),
})
await pi.waitForTimeout(3500)
const idInmo = /^#\/ver\/(.+)$/.exec(await pi.evaluate(() => location.hash))?.[1]
await pi.goto(`${VISOR}#/editar/${idInmo}`, { waitUntil: 'networkidle' })
await pi.waitForTimeout(1200)
await pi.getByRole('button', { name: 'Publicar y obtener el link' }).click()
await pi.getByLabel('Código', { exact: true }).fill(creado.codigo)
await pi.getByRole('button', { name: 'Guardar y publicar' }).click()
await esperarPublicacion(pi, pi.getByText(patronLink))
const linkInmo = (await pi.getByText(patronLink).textContent()).trim()
const llaveInmo = linkInmo.split('/t/')[1]
revisar('con el código se publica', LLAVE.test(llaveInmo), linkInmo)

const rescate = await pi.evaluate(async (id) => {
  const tours = await import('/src/lib/store/tours.ts')
  return (await tours.getTour(id)).publicacion?.editToken ?? null
}, idInmo)
revisar('y el teléfono guarda el código de rescate', typeof rescate === 'string' && LLAVE.test(rescate))
await pi.getByText('Código de rescate').click()
revisar('que el editor enseña, plegado', await pi.getByText(rescate ?? '∅').isVisible())
revisar('y el manifiesto NO lo lleva', !JSON.stringify(await (await fetch(`${WORKER}/t/${llaveInmo}/tour.json`)).json()).includes(rescate))

const usoTras = (await (await fetch(`${WORKER}/api/codigos`, { headers: maestra })).json()).find(
  (c) => c.nombre === 'Inmobiliaria de prueba',
)
revisar(
  'el uso del código sube con la casa',
  usoTras?.uso.recorridosHoy === 1 && usoTras?.uso.bytes > 100000,
  JSON.stringify(usoTras?.uso),
)

/* ── Lo que el código NO puede ────────────────────────────────────────────── */
const conCodigo = { Authorization: `Bearer ${creado.codigo}` }
const segunda = await fetch(`${WORKER}/api/nuevo`, { method: 'POST', headers: conCodigo })
revisar('la segunda casa del día choca con la cuota', segunda.status === 429, `${segunda.status} ${JSON.stringify(await segunda.json())}`)
const ajena = await fetch(`${WORKER}/api/publicar/${llave2}`, {
  method: 'PUT',
  headers: { ...conCodigo, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'x', startSceneId: 'a', scenes: [{ id: 'a', name: 'a', foto: '000.jpg', hotspots: [] }] }),
})
revisar('no puede tocar una casa que no es suya', ajena.status === 403, String(ajena.status))
const sinToken = await fetch(`${WORKER}/api/subir/${llaveInmo}/000.jpg`, {
  method: 'PUT',
  headers: conCodigo,
  body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
})
revisar('ni resubir la suya sin el código de rescate', sinToken.status === 403, String(sinToken.status))
const tokenMalo = await fetch(`${WORKER}/api/subir/${llaveInmo}/000.jpg`, {
  method: 'PUT',
  headers: { ...conCodigo, 'X-Edit-Token': 'a'.repeat(26) },
  body: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
})
revisar('ni con uno equivocado', tokenMalo.status === 403, String(tokenMalo.status))
const desconocido = await fetch(`${WORKER}/api/nuevo`, { method: 'POST', headers: { Authorization: `Bearer ${'z'.repeat(26)}` } })
revisar('un código que no existe no entra', desconocido.status === 401, String(desconocido.status))

/* ── Pero el teléfono que publicó SÍ vuelve a subir, con su rescate ───────── */
await pi.evaluate(async (id) => {
  const tours = await import('/src/lib/store/tours.ts')
  const tour = await tours.getTour(id)
  await tours.saveTour({ ...tour, title: 'Casa de la inmobiliaria' })
}, idInmo)
await pi.reload({ waitUntil: 'networkidle' })
await pi.waitForTimeout(1200)
await pi.getByRole('button', { name: 'Volver a subir con los cambios' }).click()
await esperarPublicacion(pi, pi.getByText(/El link está al día/))
const manifiestoInmo = await (await fetch(`${WORKER}/t/${llaveInmo}/tour.json`)).json()
revisar('el teléfono que publicó vuelve a subir sobre su link', manifiestoInmo.title === 'Casa de la inmobiliaria', manifiestoInmo.title)
revisar('sin errores de consola', erroresInmo.length === 0, erroresInmo.join(' | '))

/* ── Y el código da de baja su casa sin rescate: teléfono perdido ────────── */
const baja = await fetch(`${WORKER}/api/publicar/${llaveInmo}`, { method: 'DELETE', headers: conCodigo })
revisar('el código da de baja su propia casa sin rescate (teléfono perdido)', baja.status === 200, String(baja.status))
revisar('y la casa ya no está', (await fetch(`${WORKER}/t/${llaveInmo}/tour.json`)).status === 404)
const usoBaja = (await (await fetch(`${WORKER}/api/codigos`, { headers: maestra })).json()).find(
  (c) => c.nombre === 'Inmobiliaria de prueba',
)
revisar('y sus bytes se le devuelven', usoBaja?.uso.bytes === 0, JSON.stringify(usoBaja?.uso))

/* ── Revocar ─────────────────────────────────────────────────────────────── */
const revocado = await fetch(`${WORKER}/api/codigos/${usoBaja?.hash}`, { method: 'DELETE', headers: maestra })
revisar('la clave maestra revoca el código', revocado.status === 200, String(revocado.status))
revisar('y el código deja de entrar', (await fetch(`${WORKER}/api/nuevo`, { method: 'POST', headers: conCodigo })).status === 401)
await inmobiliaria.close()
} catch (e) {
  /* Un fallo a medio camino es tan rojo como una aserción: se nombra y se
     sigue al cierre, para que los logs de abajo salgan igual. */
  console.log(`\n  MURIÓ A MEDIO CAMINO: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
  bien = false
}

await browser.close()
rmSync(estado, { recursive: true, force: true })

console.log(`\n${bien ? 'LA CASA DEJÓ DE VIVIR EN UN SOLO TELÉFONO' : 'HAY ALGO MAL'}`)
if (!bien) {
  for (const h of hijos) console.log(`\n--- ${h.nombre} (últimas líneas) ---\n${h.log().slice(-2500)}`)
}
process.exit(bien ? 0 : 1)

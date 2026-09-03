/**
 * ============================================================================
 *  EL SITIO AUTOCONTENIDO ABRE DESDE CUALQUIER CARPETA, Y NADA SALE DE ELLA
 * ============================================================================
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/pruebas/sitio.mjs
 *
 * `tools/sitio.mjs` promete una carpeta que abre la casa sin Worker y sin nada
 * nuestro. Eso son tres cosas medibles, y aquí se miden las tres:
 *
 *   · la carpeta trae lo que dice: el visor, el manifiesto v2 y las fotos con los
 *     nombres que el visor espera, el index.html con el título y la tarjeta;
 *   · abre en un navegador LIMPIO servida desde un SUBDIRECTORIO cualquiera
 *     (`/una/carpeta/casa/`), con portada, marca, logo y la foto dibujada;
 *   · y NINGUNA petición sale de esa carpeta —ni al Worker, ni a las panorámicas
 *     de la demo, ni a nadie—, que es lo que "autocontenido" significa.
 *
 * No recibe URL: fabrica el `.tour` con el escritor independiente (`zipito`),
 * corre la herramienta de verdad, y sirve la carpeta con un servidor estático de
 * Node escrito aquí —no con Vite, porque un sitio que solo abre con el servidor
 * del proyecto no es autocontenido—. También con un `.tour` de la versión 1,
 * que es el que tiene un agente que exportó hace tiempo.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'

import { tourito } from './zipito.mjs'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('Falta Playwright:  npm i -D playwright && npx playwright install chromium')
  process.exit(1)
}

let bien = true
const revisar = (nombre, ok, detalle = '') => {
  console.log(`  ${nombre.padEnd(62)} ${(ok ? 'sí' : 'NO').padEnd(4)} ${detalle}`)
  if (!ok) bien = false
}

const tmp = mkdtempSync(join(tmpdir(), 'visor-sitio-'))
const SITIOS = join(tmp, 'sitios')

/* ── Un servidor estático de verdad, bajo un subdirectorio ───────────────── */

const PREFIJO = '/una/carpeta/'
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
}
const servidor = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://x')
  const relativo = pathname.startsWith(PREFIJO) ? decodeURIComponent(pathname.slice(PREFIJO.length)) : null
  const ruta = relativo === null ? null : resolve(SITIOS, relativo.endsWith('/') || relativo === '' ? `${relativo}index.html` : relativo)
  if (!ruta || !ruta.startsWith(SITIOS) || !existsSync(ruta) || statSync(ruta).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('no está')
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(ruta)] ?? 'application/octet-stream' })
  res.end(readFileSync(ruta))
})
await new Promise((r) => servidor.listen(0, '127.0.0.1', r))
const ORIGEN = `http://127.0.0.1:${servidor.address().port}`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const movil = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }

/** Cada petición que hace la página, y las que salieron mal. */
const vigilar = (page) => {
  const peticiones = []
  const fallidas = []
  const errores = []
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) peticiones.push(r.url())
  })
  page.on('response', (r) => {
    if (r.status() >= 400) fallidas.push(`${r.status()} ${r.url()}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text())
  })
  page.on('pageerror', (e) => errores.push(String(e)))
  return { peticiones, fallidas, errores }
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

const herramienta = (...args) => spawnSync(process.execPath, ['tools/sitio.mjs', ...args], { encoding: 'utf8' })
const ultimaLinea = (r) => (r.stderr || r.stdout || '').trim().split('\n').filter(Boolean).pop() ?? ''
const leer = (...partes) => readFileSync(join(...partes))
const hay = (...partes) => existsSync(join(...partes))

try {
/* ══════════════════════════════════════════════════════════════════════════
 * 1 · LA HERRAMIENTA ARMA LA CARPETA DESDE UN .tour v2
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('=== tools/sitio.mjs arma la carpeta desde un .tour ===')

const SALA = readFileSync('public/panoramas/sala.jpg')
const RECAMARA = readFileSync('public/panoramas/recamara.jpg')
const COCINA = readFileSync('public/panoramas/cocina.jpg')
const manifiestoV2 = JSON.parse(readFileSync('tools/pruebas/fixtures/v2.json', 'utf8'))
/* El fixture trae la basura que el visor tiene que filtrar (un `logoId` ajeno,
   una inyección de CSS en `ink50`, un yaw de texto). Aquí se le suman una
   miniatura y un logo como archivos, que es lo que el exportador escribe. */
manifiestoV2.recorrido.scenes[0].miniatura = 'fotos/sala.min.jpg'
manifiestoV2.recorrido.marca.logoArchivo = 'marca/logo.jpg'
const rutaTour = join(tmp, 'casa.tour')
writeFileSync(
  rutaTour,
  tourito(manifiestoV2, [
    { name: 'fotos/sala.jpg', data: SALA },
    { name: 'fotos/sala.min.jpg', data: RECAMARA },
    { name: 'marca/logo.jpg', data: COCINA },
  ]),
)

const CASA = join(SITIOS, 'casa')
const VIVIRA = 'https://ejemplo.mx/casas/lomas/'
const corrida = herramienta(rutaTour, CASA, '--url', VIVIRA)
revisar('la herramienta termina bien', corrida.status === 0, ultimaLinea(corrida))
if (corrida.status !== 0) console.log(corrida.stdout, corrida.stderr)

revisar(
  'deja el visor, el manifiesto y las fotos',
  ['index.html', 'recorrido/tour.json', 'recorrido/fotos/000.jpg', 'recorrido/fotos/001.jpg', 'recorrido/fotos/000.min.jpg', 'recorrido/fotos/logo.jpg'].every(
    (a) => hay(CASA, a),
  ),
)
const tourJson = hay(CASA, 'recorrido/tour.json') ? JSON.parse(leer(CASA, 'recorrido/tour.json').toString()) : {}
revisar(
  'el manifiesto es la v2 con las fotos renumeradas como las publica el Worker',
  tourJson.version === 2 &&
    tourJson.title === 'Casa de prueba v2' &&
    tourJson.scenes?.[0]?.foto === '000.jpg' &&
    tourJson.scenes?.[0]?.miniatura === '000.min.jpg' &&
    tourJson.scenes?.[1]?.foto === '001.jpg' &&
    tourJson.scenes?.[1]?.miniatura === undefined,
  JSON.stringify(tourJson.scenes?.map((e) => [e.foto, e.miniatura])),
)
revisar('con la ficha, la marca y el kiosco', tourJson.ficha?.precio === 'Desde $1.9M' && tourJson.marca?.nombre === 'Inmobiliaria del Valle' && tourJson.autogiro === true)
revisar('el logo va como archivo con la extensión de su tipo, y sin el logoId ajeno', tourJson.marca?.logo === 'logo.jpg' && tourJson.marca?.logoId === undefined, String(tourJson.marca?.logo))
revisar('las fotos son los bytes del .tour, sin recomprimir', hay(CASA, 'recorrido/fotos/000.jpg') && leer(CASA, 'recorrido/fotos/000.jpg').equals(SALA) && leer(CASA, 'recorrido/fotos/000.min.jpg').equals(RECAMARA))

const html = hay(CASA, 'index.html') ? leer(CASA, 'index.html').toString() : ''
revisar('<title> es el nombre de la casa', /<title>Casa de prueba v2<\/title>/.test(html))
revisar('la tarjeta lleva el precio y la casa, y la dirección', html.includes('property="og:title" content="Desde $1.9M · Casa de prueba v2"') && html.includes('property="og:description" content="Av. Vallarta 1234, Zapopan"'))
revisar('y la inmobiliaria', html.includes('property="og:site_name" content="Inmobiliaria del Valle"'))
revisar('con --url, la imagen de la tarjeta es la miniatura donde va a vivir', html.includes(`property="og:image" content="${VIVIRA}recorrido/fotos/000.min.jpg"`))
revisar('el preload apunta a la primera foto de ESTA casa, no a la demo', html.includes('href="./recorrido/fotos/000.jpg"') && !html.includes('panoramas/sala.jpg'))
revisar('la barra del teléfono lleva el fondo de la marca', html.includes('<meta name="theme-color" content="#0a0a12"'))
revisar('sin las panorámicas de la demo ni la página de diagnóstico', !hay(CASA, 'panoramas') && !hay(CASA, 'prueba.html') && hay(CASA, 'favicon.svg'))
const ocupada = herramienta(rutaTour, CASA)
revisar('no vacía una carpeta ocupada sin --forzar', ocupada.status !== 0 && /--forzar/.test(ocupada.stderr), ultimaLinea(ocupada))

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · LA CASA ABRE EN UN NAVEGADOR LIMPIO, SERVIDA DESDE UNA SUBCARPETA
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== La casa abre en un navegador limpio, servida desde /una/carpeta/casa/ ===')

const URL_CASA = `${ORIGEN}${PREFIJO}casa/`
const comprador = await browser.newContext(movil)
const pc = await comprador.newPage()
const red = vigilar(pc)

await pc.goto(URL_CASA, { waitUntil: 'networkidle' })
await pc.waitForTimeout(1500)
revisar('abre en la PORTADA, con el precio', await pc.getByText('Desde $1.9M').isVisible())
revisar('sin WebGL todavía', await pc.evaluate(() => document.querySelectorAll('canvas').length === 0))
const acento = await pc.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-brand-500').trim())
revisar('con la marca puesta: el acento de la inmobiliaria', acento === '#7c3aed', acento)
const ink50 = await pc.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-ink-50').trim())
revisar('y la inyección de CSS del archivo filtrada, como en el .tour', !ink50.includes('invert'), ink50)
revisar('y su logo, desde la propia carpeta', (await pc.locator(`img[src$="recorrido/fotos/logo.jpg"]`).count()) === 1)
revisar('el fondo de la portada es la miniatura, ya cargada', await pc.evaluate(() => [...document.images].some((i) => /recorrido\/fotos\/000\.min\.jpg$/.test(i.src) && i.naturalWidth > 0)))
revisar('no toca IndexedDB', (await pc.evaluate(() => indexedDB.databases().then((d) => d.length))) === 0)

await pc.getByRole('button', { name: /Ver el recorrido/ }).click()
await pc.waitForTimeout(5000)
revisar('al entrar aparece el visor 3D', await pc.evaluate(() => document.querySelectorAll('canvas').length > 0))
const brillo = await brilloDe(pc)
revisar('y la foto se dibuja: no es un cuarto negro', brillo > 40, `brillo ${brillo}`)
revisar('con las habitaciones en la barra', (await pc.getByRole('button', { name: 'Sala', exact: true }).isVisible()) && (await pc.getByRole('button', { name: 'Patio', exact: true }).isVisible()))
await pc.getByRole('button', { name: 'Sala', exact: true }).click()
await pc.waitForTimeout(1500)

const fuera = red.peticiones.filter((u) => !u.startsWith(URL_CASA))
revisar('NINGUNA petición salió de la carpeta', red.peticiones.length > 5 && fuera.length === 0, fuera.slice(0, 3).join(' ') || `${red.peticiones.length} peticiones, todas dentro`)
revisar('y todo lo que pidió estaba: nada dio 404', red.fallidas.length === 0, red.fallidas.slice(0, 3).join(' '))
revisar('sin errores de consola', red.errores.length === 0, red.errores.join(' | '))

/* Cualquier ruta enseña la casa: el link que recibe un comprador no debe abrir
   la administración de nadie aunque le agreguen `#/inicio` a mano. */
const p2 = await comprador.newPage()
await p2.goto(`${URL_CASA}#/inicio`, { waitUntil: 'networkidle' })
await p2.waitForTimeout(1500)
revisar('#/inicio también enseña la casa, no "Mis recorridos"', (await p2.getByText('Desde $1.9M').isVisible()) && (await p2.getByText('Mis recorridos').count()) === 0)
await comprador.close()

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · UN .tour DE LA VERSIÓN 1 TAMBIÉN
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('\n=== Un .tour de la versión 1 también (sin ficha: abre directo en el visor) ===')

const V1 = join(SITIOS, 'v1')
const corridaV1 = herramienta('tools/pruebas/fixtures/v1.tour', V1)
revisar('la herramienta termina bien con un .tour v1', corridaV1.status === 0, ultimaLinea(corridaV1))
const htmlV1 = hay(V1, 'index.html') ? leer(V1, 'index.html').toString() : ''
revisar('<title> es el nombre de esa casa', /<title>Casa de prueba v1<\/title>/.test(htmlV1))
revisar('sin --url, la tarjeta va sin imagen (Open Graph pide direcciones absolutas)', htmlV1.includes('property="og:title"') && !htmlV1.includes('og:image'))

const URL_V1 = `${ORIGEN}${PREFIJO}v1/`
const otro = await browser.newContext(movil)
const pv = await otro.newPage()
const redV1 = vigilar(pv)
await pv.goto(URL_V1, { waitUntil: 'networkidle' })
await pv.waitForTimeout(5000)
revisar('sin ficha no hay portada: abre directo en el visor 3D', await pv.evaluate(() => document.querySelectorAll('canvas').length > 0))
const brilloV1 = await brilloDe(pv)
revisar('y dibuja', brilloV1 > 40, `brillo ${brilloV1}`)
const fueraV1 = redV1.peticiones.filter((u) => !u.startsWith(URL_V1))
revisar('NINGUNA petición salió de su carpeta', redV1.peticiones.length > 5 && fueraV1.length === 0, fueraV1.slice(0, 3).join(' '))
revisar('nada dio 404 ni hubo errores', redV1.fallidas.length === 0 && redV1.errores.length === 0, [...redV1.fallidas, ...redV1.errores].slice(0, 3).join(' | '))
await otro.close()
} catch (e) {
  console.log(`\n  MURIÓ A MEDIO CAMINO: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`)
  bien = false
}

await browser.close()
servidor.close()
rmSync(tmp, { recursive: true, force: true })

console.log(`\n${bien ? 'LA CASA ABRE DESDE SU PROPIA CARPETA, Y NADA SALE DE ELLA' : 'HAY ALGO MAL'}`)
process.exit(bien ? 0 : 1)

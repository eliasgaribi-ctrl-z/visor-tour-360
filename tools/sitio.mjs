#!/usr/bin/env node
/**
 * ============================================================================
 *  LA CASA COMO SITIO ESTÁTICO AUTOCONTENIDO
 * ============================================================================
 *
 *   node tools/sitio.mjs <casa.tour | https://…/t/<llave>> <carpeta> [--url https://donde.vivira/casa/] [--forzar]
 *
 * Responde a la objeción de venta que toda inmobiliaria hace tarde o temprano:
 * "¿y si ustedes cierran?". La respuesta es una carpeta: el visor compilado Y el
 * recorrido, juntos, que se suben a cualquier hosting estático —el de la
 * inmobiliaria, Netlify, S3, una carpeta de un servidor viejo— y abren la casa
 * sin Worker, sin nuestro dominio y sin nada que haya que mantener.
 *
 * ── De dónde sale la casa ──────────────────────────────────────────────────
 *
 *   · de un `.tour`: el archivo que el agente exportó desde su teléfono. Se lee
 *     con un lector de ZIP propio (Node no trae uno) y las fotos se renumeran
 *     `000.jpg`, `000.min.jpg`… exactamente como hace el publicador, para que el
 *     manifiesto que se escribe sea el MISMO v2 que baja del Worker;
 *   · de un link: la casa ya publicada. Se baja el manifiesto tal cual y cada
 *     archivo que nombra —la variante de 2048 incluida—.
 *
 * Los dos caminos terminan en la misma carpeta:
 *
 *   <carpeta>/index.html            el visor, compilado con VITE_SITIO=1 y base ./
 *   <carpeta>/assets/…              su JavaScript y su CSS
 *   <carpeta>/recorrido/tour.json   el manifiesto v2
 *   <carpeta>/recorrido/fotos/…     las fotos y el logo
 *
 * `--base=./` es lo que hace portable la carpeta (la misma razón por la que el
 * sitio de GitHub Pages funciona bajo /repositorio/): todo es relativo al
 * index.html, así que da igual bajo qué subcarpeta del dominio acabe.
 *
 * ── Lo que retoca del index.html ───────────────────────────────────────────
 *
 * El título, la tarjeta de WhatsApp (Open Graph: precio · casa, la dirección, la
 * inmobiliaria), el `preload` de la primera foto —que en el sitio normal apunta
 * a la panorámica de la demo, y aquí a la primera habitación de ESTA casa— y el
 * color de la barra del teléfono si la marca trae fondo. La imagen de la tarjeta
 * solo va con `--url`: Open Graph exige direcciones absolutas y la herramienta
 * no puede adivinar dónde va a vivir la carpeta.
 *
 * Y quita lo que en este sitio no tiene sentido: las panorámicas de ejemplo
 * (945 kB que nadie vería) y la página de diagnóstico.
 *
 * ── Lo que NO hace ─────────────────────────────────────────────────────────
 *
 * Métricas: no hay a quién reportarlas, y esa es la idea. El visor de la carpeta
 * no manda ni una petición fuera de ella; `tools/pruebas/sitio.mjs` lo mide.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VITE = join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js')

/** La misma carpeta que lee `VisorSitio.tsx`. */
const CARPETA = 'recorrido'
/** Lo único que se copia a `recorrido/fotos/`: la forma que admite el visor. */
const ARCHIVO_VALIDO = /^([0-9]{3}(\.min|\.2k)?\.jpg|logo\.(png|jpg|webp))$/
const EXTENSION_DE_LOGO = { '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.webp': 'webp' }

function morir(mensaje) {
  console.error(`\n${mensaje}`)
  process.exit(1)
}

/* ── Argumentos ──────────────────────────────────────────────────────────── */

const posicionales = []
let url
let forzar = false
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--url') url = args[++i]
  else if (a.startsWith('--url=')) url = a.slice('--url='.length)
  else if (a === '--forzar') forzar = true
  else if (a.startsWith('--')) morir(`No conozco la opción ${a}.`)
  else posicionales.push(a)
}
const [origen, salidaCruda] = posicionales
if (!origen || !salidaCruda) {
  console.error(`Uso:
  node tools/sitio.mjs <casa.tour | https://…/t/<llave>> <carpeta> [--url https://donde.vivira/casa/] [--forzar]

  --url     dónde va a vivir la carpeta, con barra final: es lo que permite que la
            tarjeta de WhatsApp lleve imagen (Open Graph pide direcciones absolutas)
  --forzar  reemplazar lo que haya en <carpeta> si no está vacía`)
  process.exit(2)
}
if (url !== undefined) {
  if (!/^https?:\/\/\S+$/i.test(url)) morir(`--url tiene que ser una dirección https://…, no "${url}".`)
  if (!url.endsWith('/')) url += '/'
}

const salida = resolve(salidaCruda)
if (salida === RAIZ || RAIZ.startsWith(salida + sep)) morir('Esa carpeta contiene el proyecto: no la voy a vaciar.')
if (existsSync(salida)) {
  if (!statSync(salida).isDirectory()) morir(`${salida} existe y no es una carpeta.`)
  if (readdirSync(salida).length > 0 && !forzar) {
    morir(`La carpeta ${salida} no está vacía. Si quieres reemplazar lo que tiene, agrega --forzar.`)
  }
}

/* ── Un lector de ZIP para Node ──────────────────────────────────────────────
 *
 * El del proyecto (src/lib/store/zip.ts) está escrito para el navegador —lee
 * Blobs y descomprime con DecompressionStream— y Node no trae ninguno. Este es
 * el mínimo que hace falta para un .tour: directorio central, cabecera local,
 * entradas sin comprimir (lo único que el visor escribe) y deflate por si
 * alguien volvió a empaquetar el archivo con otra herramienta.
 */
const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

function nombreSeguro(nombre) {
  if (!nombre || nombre.length > 255) return false
  if (nombre.startsWith('/') || nombre.includes('\\')) return false
  return !nombre.split('/').some((parte) => parte === '..' || parte === '.')
}

function leerZip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('no parece un ZIP (no tiene fin de directorio central)')

  const cuenta = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (cuenta === 0xffff || p === 0xffffffff) throw new Error('usa ZIP64, que aquí no se lee')

  const archivos = new Map()
  for (let i = 0; i < cuenta; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('directorio central dañado')
    const metodo = buf.readUInt16LE(p + 10)
    const comprimido = buf.readUInt32LE(p + 20)
    const largoNombre = buf.readUInt16LE(p + 28)
    const largoExtra = buf.readUInt16LE(p + 30)
    const largoComentario = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const nombre = buf.toString('utf8', p + 46, p + 46 + largoNombre)

    if (local + 30 > buf.length || buf.readUInt32LE(local) !== SIG_LOCAL) {
      throw new Error(`cabecera de "${nombre}" dañada`)
    }
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    if (inicio + comprimido > buf.length) throw new Error(`"${nombre}" está incompleto: el archivo se truncó`)
    const crudo = buf.subarray(inicio, inicio + comprimido)

    if (!nombre.endsWith('/') && nombreSeguro(nombre)) {
      if (metodo === 0) archivos.set(nombre, crudo)
      else if (metodo === 8) archivos.set(nombre, inflateRawSync(crudo))
      else throw new Error(`"${nombre}" usa un método de compresión (${metodo}) que no se entiende`)
    }
    p += 46 + largoNombre + largoExtra + largoComentario
  }
  return archivos
}

/* ── Fuente 1: el .tour ──────────────────────────────────────────────────────
 *
 * Del manifiesto del .tour (`recorrido.json`, con `archivo`/`miniatura` como
 * rutas dentro del ZIP) al manifiesto publicado (v2, con `foto`/`miniatura`
 * como nombres de `recorrido/fotos/`). Es la misma traducción que hace
 * `armarManifiesto` en src/lib/publicar.ts, sin IndexedDB en medio.
 *
 * No se sanea aquí: lo sanea el visor al abrirlo, con los mismos filtros que
 * aplica a lo que baja del Worker. La herramienta solo mueve y renombra.
 */
function desdeTour(ruta) {
  let zip
  try {
    zip = leerZip(readFileSync(ruta))
  } catch (e) {
    morir(`No se pudo leer ${ruta}: ${e instanceof Error ? e.message : e}.`)
  }
  const crudo = zip.get('recorrido.json')
  if (!crudo) morir(`${ruta} no es un .tour del visor: le falta recorrido.json.`)
  let m
  try {
    m = JSON.parse(crudo.toString('utf8'))
  } catch {
    morir('El recorrido.json del .tour no es JSON.')
  }
  if (m.formato !== 'visor-tour-360') morir('Ese archivo lo hizo otro programa.')
  if (typeof m.version !== 'number' || m.version > 2) {
    morir(`El .tour es de la versión ${m.version} y esta herramienta lee hasta la 2: actualiza el proyecto.`)
  }
  const r = m.recorrido
  if (!r || typeof r !== 'object' || !Array.isArray(r.scenes)) morir('El .tour no trae habitaciones.')

  const archivos = new Map()
  const scenes = []
  for (const e of r.scenes) {
    if (!e || typeof e !== 'object' || typeof e.archivo !== 'string') continue
    const foto = zip.get(e.archivo)
    if (!foto) continue // una habitación sin foto se omite, como hacen los dos lectores del .tour

    const numero = String(scenes.length).padStart(3, '0')
    archivos.set(`${numero}.jpg`, foto)
    const escena = { id: e.id, name: e.name, foto: `${numero}.jpg`, initialYaw: e.initialYaw, hotspots: e.hotspots }
    const mini = typeof e.miniatura === 'string' ? zip.get(e.miniatura) : undefined
    if (mini) {
      archivos.set(`${numero}.min.jpg`, mini)
      escena.miniatura = `${numero}.min.jpg`
    }
    for (const campo of ['rumbo', 'nivel', 'coverageDeg']) if (e[campo] !== undefined) escena[campo] = e[campo]
    scenes.push(escena)
  }
  if (scenes.length === 0) morir('Ninguna habitación del .tour trae su foto: no hay nada que enseñar.')

  const manifiesto = { version: 2, title: r.title, subtitle: r.subtitle, startSceneId: r.startSceneId, scenes }
  if (r.ficha && typeof r.ficha === 'object') manifiesto.ficha = r.ficha
  if (r.marca && typeof r.marca === 'object') {
    /* `logoId` es una llave de IndexedDB del teléfono que exportó: no significa
       nada aquí. El logo cruza como archivo, con la extensión de su tipo. */
    const marca = { ...r.marca }
    const logoArchivo = marca.logoArchivo
    delete marca.logoArchivo
    delete marca.logoId
    if (typeof logoArchivo === 'string') {
      const logo = zip.get(logoArchivo)
      const extension = EXTENSION_DE_LOGO[extname(logoArchivo).toLowerCase()]
      if (logo && extension) {
        archivos.set(`logo.${extension}`, logo)
        marca.logo = `logo.${extension}`
      }
    }
    manifiesto.marca = marca
  }
  if (r.autogiro === true) manifiesto.autogiro = true
  return { manifiesto, archivos }
}

/* ── Fuente 2: el link de la casa publicada ──────────────────────────────── */

async function desdeLink(entrada) {
  const base = entrada.replace(/\/tour\.json$/, '').replace(/\/+$/, '')
  let respuesta
  try {
    respuesta = await fetch(`${base}/tour.json`)
  } catch (e) {
    morir(`No se pudo conectar a ${base}: ${e instanceof Error ? e.message : e}.`)
  }
  if (respuesta.status === 404) morir(`${base}/tour.json no existe: ¿la casa sigue publicada?`)
  if (!respuesta.ok) morir(`${base}/tour.json respondió ${respuesta.status}.`)
  const manifiesto = await respuesta.json()
  if (!manifiesto || typeof manifiesto !== 'object' || !Array.isArray(manifiesto.scenes)) {
    morir('Lo que hay en ese link no es un recorrido publicado.')
  }

  const archivos = new Map()
  const bajar = async (nombre) => {
    if (typeof nombre !== 'string' || !ARCHIVO_VALIDO.test(nombre)) return false
    if (archivos.has(nombre)) return true
    const r = await fetch(`${base}/fotos/${nombre}`)
    if (!r.ok) return false
    archivos.set(nombre, Buffer.from(await r.arrayBuffer()))
    return true
  }

  for (const e of manifiesto.scenes) {
    if (!e || typeof e !== 'object') continue
    await bajar(e.foto)
    /* Una copia que el manifiesto promete y no está, no se promete: mejor la
       completa que un cuarto negro. */
    for (const campo of ['miniatura', 'foto2048']) {
      if (e[campo] !== undefined && !(await bajar(e[campo]))) delete e[campo]
    }
  }
  manifiesto.scenes = manifiesto.scenes.filter((e) => e && typeof e === 'object' && archivos.has(e.foto))
  if (manifiesto.scenes.length === 0) morir('No se pudo bajar ninguna foto de esa casa.')
  if (manifiesto.marca && typeof manifiesto.marca === 'object' && manifiesto.marca.logo !== undefined) {
    if (!(await bajar(manifiesto.marca.logo))) delete manifiesto.marca.logo
  }
  return { manifiesto, archivos }
}

/* ── El visor ────────────────────────────────────────────────────────────── */

function compilarVisor(carpeta) {
  if (!existsSync(VITE)) morir('Vite no está instalado: corre `npm ci` en la raíz del proyecto primero.')
  /* `--mode sitio` a propósito: así no se lee `.env.production` (donde vive la
     dirección del Worker) y `VITE_PUBLICAR_BASE` queda vacía además por el
     entorno. Este visor no tiene a dónde publicar ni a quién reportar. */
  const r = spawnSync(
    process.execPath,
    [VITE, 'build', '--base=./', '--mode', 'sitio', '--outDir', carpeta, '--emptyOutDir', '--logLevel', 'error'],
    { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, VITE_SITIO: '1', VITE_PUBLICAR_BASE: '' } },
  )
  if (r.status !== 0) morir('No se pudo compilar el visor (el error está arriba).')
}

function escribirRecorrido(carpeta, manifiesto, archivos) {
  const fotos = join(carpeta, CARPETA, 'fotos')
  mkdirSync(fotos, { recursive: true })
  for (const [nombre, datos] of archivos) writeFileSync(join(fotos, nombre), datos)
  writeFileSync(join(carpeta, CARPETA, 'tour.json'), JSON.stringify(manifiesto, null, 2))
}

const escapar = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const textoDe = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

function retocarIndex(carpeta, manifiesto) {
  const ruta = join(carpeta, 'index.html')
  let html = readFileSync(ruta, 'utf8')

  const titulo = textoDe(manifiesto.title) ?? 'Recorrido virtual 360'
  const ficha = manifiesto.ficha && typeof manifiesto.ficha === 'object' ? manifiesto.ficha : {}
  const precio = textoDe(ficha.precio)
  const descripcion = textoDe(ficha.direccion) ?? textoDe(manifiesto.subtitle)
  const marca = manifiesto.marca && typeof manifiesto.marca === 'object' ? manifiesto.marca : {}
  const primera = manifiesto.scenes[0]
  const portada = primera.miniatura ?? primera.foto

  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapar(titulo)}</title>`)
  /* El preload de la primera panorámica existe para que la foto más pesada
     empiece a bajar antes que el JavaScript. En el sitio normal apunta a la
     demo; aquí, a la primera habitación de esta casa. */
  html = html.replace(/href="[^"]*panoramas\/sala\.jpg"/, `href="./${CARPETA}/fotos/${primera.foto}"`)
  const fondo = textoDe(marca.fondoApp)
  if (fondo && /^#[0-9a-f]{6}$/i.test(fondo)) {
    html = html.replace(/(<meta name="theme-color" content=")[^"]*(")/, `$1${fondo}$2`)
  }

  const metas = [
    ['property', 'og:type', 'website'],
    ['property', 'og:title', precio ? `${precio} · ${titulo}` : titulo],
    descripcion && ['property', 'og:description', descripcion],
    descripcion && ['name', 'description', descripcion],
    textoDe(marca.nombre) && ['property', 'og:site_name', textoDe(marca.nombre)],
    url && ['property', 'og:url', url],
    url && ['property', 'og:image', `${url}${CARPETA}/fotos/${portada}`],
    url && ['name', 'twitter:card', 'summary_large_image'],
  ].filter(Boolean)
  const bloque = metas.map(([atributo, nombre, contenido]) => `    <meta ${atributo}="${nombre}" content="${escapar(contenido)}" />`)
  html = html.replace('</head>', `${bloque.join('\n')}\n  </head>`)

  writeFileSync(ruta, html)
  return titulo
}

/** Lo que `public/` mete en todo build y en este sitio no pinta nada. */
function podar(carpeta) {
  rmSync(join(carpeta, 'panoramas'), { recursive: true, force: true })
  rmSync(join(carpeta, 'prueba.html'), { force: true })
}

function pesar(dir) {
  let bytes = 0
  let archivos = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const s = pesar(p)
      bytes += s.bytes
      archivos += s.archivos
    } else {
      bytes += statSync(p).size
      archivos++
    }
  }
  return { bytes, archivos }
}

/* ── A trabajar ──────────────────────────────────────────────────────────── */

const esLink = /^https?:\/\//i.test(origen)
console.log(`· Leyendo ${esLink ? 'la casa publicada en' : 'el archivo'} ${origen}…`)
if (!esLink && !existsSync(origen)) morir(`No existe ${origen}.`)
const { manifiesto, archivos } = esLink ? await desdeLink(origen) : desdeTour(origen)
console.log(
  `  ${manifiesto.scenes.length} ${manifiesto.scenes.length === 1 ? 'habitación' : 'habitaciones'}, ${archivos.size} archivos` +
    (manifiesto.marca?.logo ? ', con logo' : ''),
)

console.log('· Compilando el visor…')
compilarVisor(salida)

console.log(`· Escribiendo ${CARPETA}/…`)
escribirRecorrido(salida, manifiesto, archivos)

console.log('· Retocando index.html: título, tarjeta de WhatsApp, preload…')
const titulo = retocarIndex(salida, manifiesto)
podar(salida)

const peso = pesar(salida)
console.log(`
Listo: ${salidaCruda} — "${titulo}", ${peso.archivos} archivos, ${(peso.bytes / 1048576).toFixed(1)} MB.
  Súbela tal cual a cualquier hosting estático; funciona bajo cualquier subcarpeta.
  Para verla en esta computadora (por http, no con doble clic):
    python3 -m http.server -d ${salidaCruda} 8000   →   http://localhost:8000/`)
if (!url) {
  console.log(`  La tarjeta de WhatsApp va SIN imagen: para que la lleve, vuelve a correr con
    --url https://donde-va-a-vivir/la-casa/   (Open Graph pide direcciones absolutas)`)
}

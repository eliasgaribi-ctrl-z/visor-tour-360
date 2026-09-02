/**
 * ============================================================================
 *  EL FORMATO `.tour`: ABRE LO VIEJO Y VUELVE ENTERO
 * ============================================================================
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/pruebas/formato.mjs http://localhost:5173/
 *
 * Al subir `FORMAT_VERSION` a 2 se le hicieron DOS promesas a quien ya tenga
 * recorridos guardados, y esta prueba cobra las dos:
 *
 *   1. los `.tour` de la versión 1 se siguen abriendo;
 *   2. lo que el visor ESCRIBE, el visor lo vuelve a leer igual.
 *
 * ── Por qué la segunda tardó en existir, que es la parte que enseña ────────
 *
 * El encabezado de este archivo prometía la ida y vuelta desde el primer día y
 * el arnés nunca exportaba nada: terminaba en la portada. Con eso, el camino de
 * ESCRITURA de la v2 —el único lugar donde `marca` y `ficha` se serializan— no
 * lo ejecutaba ninguna de las ocho pruebas del proyecto. Tres defectos de
 * corrupción de datos vivían justo ahí, y escribir esta mitad es lo que los
 * destapó. Un encabezado no es una prueba.
 *
 * ── De dónde salen los archivos ───────────────────────────────────────────
 *
 * `fixtures/v1.tour` es un binario escrito a mano, con el manifiesto exacto de
 * la versión 1. `fixtures/v2.json` es el manifiesto v2 en texto plano —para que
 * se pueda leer y revisar en un diff— y el ZIP se arma aquí con `zipito.mjs`,
 * que es un escritor INDEPENDIENTE del `zip.ts` del proyecto. Los dos casos
 * comparten la razón: un archivo generado por el código de hoy solo probaría que
 * el código de hoy se entiende consigo mismo, que no es la pregunta.
 *
 * El v2 lleva basura adentro a propósito: un color con una inyección de CSS,
 * otro que no es hex, una tipografía que no está en la lista blanca, un
 * `logoId` de otro teléfono y un `initialYaw` que es string en vez de número.
 * Nada de eso debe sobrevivir a la frontera.
 */
import { readFileSync } from 'node:fs'

import { tourito, zipito } from './zipito.mjs'

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
  console.log(`  ${nombre.padEnd(44)} ${(ok ? 'sí' : 'NO').padEnd(4)} ${detalle}`)
  if (!ok) bien = false
}

/** Compara dos objetos SOLO en los campos que se piden. Devuelve los que difieren. */
const diferencias = (a, b, campos) =>
  campos.filter((c) => JSON.stringify(a?.[c]) !== JSON.stringify(b?.[c]))

/** Le da un archivo al `<input type=file>` de "Mis recorridos" y espera. */
const meterArchivo = async (nombre, buffer, espera = 3000) => {
  await page.setInputFiles('input[type=file]', {
    name: nombre,
    mimeType: 'application/zip',
    buffer,
  })
  await page.waitForTimeout(espera)
}

console.log('=== El formato .tour abre lo viejo ===')

await page.goto(`${BASE}#/inicio`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

/* Se le da el archivo al `<input type=file>` directamente y no se abre el
   diálogo del sistema: Playwright no puede tocar ese diálogo, y de todos modos
   lo que se quiere probar es el manejador, no el selector del sistema. */
await meterArchivo('v1.tour', readFileSync('tools/pruebas/fixtures/v1.tour'))

const abrio = await page.getByText('Casa de prueba v1').first().isVisible().catch(() => false)
revisar('un .tour de la versión 1 se importa', abrio)

/* ── A dónde CAE quien acaba de abrir un .tour ────────────────────────────
 *
 * Al visor, no a la pantalla de administración. Es la mitad del arreglo que más
 * costaba ver: mientras el importador terminaba en `#/editar/<id>`, el
 * desconocido que recibe el archivo por WhatsApp caía entre los botones de
 * "Borrar la habitación" y "Preparar archivo", y la portada que se construyó
 * para él era inalcanzable en la práctica.
 *
 * Esta prueba no lo veía porque navegaba a `#/ver/<id>` a mano. Ahora se exige
 * el hash. */
const hashTrasImportar = await page.evaluate(() => location.hash)
revisar('y cae en el visor, no en el editor', /^#\/ver\//.test(hashTrasImportar), hashTrasImportar)

/* Y hay que comprobar que llegó COMPLETO, no solo que apareció el título: una
   migración descuidada puede tragarse las habitaciones o los puntos y dejar el
   nombre intacto. */
const leerGuardado = (titulo) =>
  page.evaluate(async (t) => {
    const mod = await import('/src/lib/store/tours.ts')
    const lista = await mod.listTours()
    const fila = lista.find((x) => x.title === t)
    return fila ? await mod.getTour(fila.id) : null
  }, titulo)

const guardado = await leerGuardado('Casa de prueba v1')
revisar(
  'con sus 2 habitaciones',
  guardado?.scenes.length === 2,
  JSON.stringify(guardado?.scenes.map((s) => s.name) ?? []),
)
revisar('con sus 2 puntos', guardado?.scenes.reduce((n, s) => n + s.hotspots.length, 0) === 2)
revisar('y el enlace apunta a la cocina', guardado?.scenes[0]?.hotspots?.[0]?.to === 'cocina')
revisar('la habitación inicial se respeta', guardado?.startSceneId === 'sala')
revisar('el subtítulo se conserva', !!guardado?.subtitle)
revisar(
  'sin inventar marca ni ficha',
  guardado?.marca === undefined && guardado?.ficha === undefined,
)

/* ==========================================================================
 * Y el camino nuevo completo: llenar la ficha de la casa y ver la PORTADA.
 *
 * Es el entregable de la fase, así que se prueba por donde de verdad se usa —la
 * interfaz— y no llamando funciones por dentro. Si la hoja del editor deja de
 * guardar, o el visor deja de mostrar la portada, esto lo dice.
 * ========================================================================== */
console.log('\n=== La ficha de la casa llega hasta la portada ===')

await page.goto(`${BASE}#/inicio`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

/* Al editor por el lápiz de la fila, que es el camino real del agente. Existe
   justo para que llevar la tarjeta al visor no le cobrara dos toques —ni la
   descarga del motor 3D— cada vez que quiere editar. */
await page.getByRole('button', { name: 'Editar Casa de prueba v1' }).click()
await page.waitForTimeout(1200)
revisar('el lápiz de la fila lleva al editor', /^#\/editar\//.test(await page.evaluate(() => location.hash)))

await page.getByRole('button', { name: /Agregar los datos|Cambiar los datos/ }).click()
await page.waitForTimeout(600)

const PRECIO = '$1,950,000'
const DIRECCION = 'Fracc. Los Robles, Tlajomulco'
/* Por ROL y nombre accesible y no por placeholder: `getByPlaceholder` hace
   coincidencia por subcadena, así que un placeholder "3" también encontraba
   "52 33 1234 5678" y "33 1234 5678". Y de paso esto comprueba que cada campo
   tenga su etiqueta bien asociada, que es lo que lee un lector de pantalla. */
const campo = (nombre) => page.getByRole('textbox', { name: nombre })
await campo(/^Precio/).fill(PRECIO)
await campo(/^Superficie/).fill('132 m²')
await campo(/^Recámaras/).fill('3')
await campo(/^Baños/).fill('2')
await campo(/^Dirección/).fill(DIRECCION)
await campo(/^WhatsApp/).fill('52 33 1234 5678')
await page.getByRole('button', { name: 'Guardar', exact: true }).click()
await page.waitForTimeout(1500)

const idTour = await page.evaluate(() => location.hash.split('/')[2])

/* ── Y ahora la portada, llegando por donde llega el comprador ────────────
 * Tocando la TARJETA de "Mis recorridos", no navegando al hash a mano. Esa
 * navegación a mano es exactamente lo que hacía que la prueba pasara mientras
 * la portada era inalcanzable. */
await page.goto(`${BASE}#/inicio`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.getByText('Casa de prueba v1').first().click()
await page.waitForTimeout(2500)
revisar('la tarjeta de la lista lleva al visor', /^#\/ver\//.test(await page.evaluate(() => location.hash)))

const enPortada = {
  precio: await page.getByText(PRECIO).first().isVisible().catch(() => false),
  direccion: await page.getByText(DIRECCION).first().isVisible().catch(() => false),
  metros: await page.getByText('132 m²').first().isVisible().catch(() => false),
  entrar: await page.getByRole('button', { name: /Ver el recorrido/ }).isVisible().catch(() => false),
  whatsapp: await page.getByRole('link', { name: 'WhatsApp' }).isVisible().catch(() => false),
}
revisar('la portada muestra el precio', enPortada.precio)
revisar('la dirección y los metros', enPortada.direccion && enPortada.metros)
revisar('el botón de entrar', enPortada.entrar)
revisar('y el contacto de WhatsApp', enPortada.whatsapp)

/* El enlace de WhatsApp tiene que quedar con solo dígitos: `limpiarFicha` quita
   los espacios, porque wa.me no los acepta. */
const wa = await page.getByRole('link', { name: 'WhatsApp' }).getAttribute('href').catch(() => null)
revisar('el link de WhatsApp va limpio', wa === 'https://wa.me/523312345678', String(wa))

/* ── El correo se conserva al reeditar ────────────────────────────────────
 * La hoja del editor reconstruye el objeto `agente` desde cero. Cuando le
 * faltaba el campo de correo, abrir "Cambiar los datos" y tocar Guardar sin
 * escribir nada BORRABA el correo que viniera de un .tour importado. */
await page.goto(`${BASE}#/editar/${idTour}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.getByRole('button', { name: /Cambiar los datos/ }).click()
await page.waitForTimeout(500)
await campo(/^Correo/).fill('elias@thiqa.mx')
await page.getByRole('button', { name: 'Guardar', exact: true }).click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: /Cambiar los datos/ }).click()
await page.waitForTimeout(500)
const correoTrasReeditar = await campo(/^Correo/).inputValue()
await page.getByRole('button', { name: 'Guardar', exact: true }).click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: /Cambiar los datos/ }).click()
await page.waitForTimeout(500)
const correoTrasGuardarVacio = await campo(/^Correo/).inputValue()
revisar(
  'el correo sobrevive a reeditar',
  correoTrasReeditar === 'elias@thiqa.mx' && correoTrasGuardarVacio === 'elias@thiqa.mx',
  `${correoTrasReeditar} / ${correoTrasGuardarVacio}`,
)

/* Ese bloque dejó la página en el editor; el resto del flujo sigue en el visor.
   (La primera versión no volvía y el clic de "Ver el recorrido" se colgaba 30 s
   buscando un botón que estaba en otra pantalla.) */
await page.goto(`${BASE}#/ver/${idTour}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

/* Y la portada NO puede necesitar WebGL: es su mayor valor en un iPhone viejo,
   donde el visor 3D no puede funcionar. */
const sinCanvas = await page.evaluate(() => document.querySelectorAll('canvas').length === 0)
revisar('la portada monta sin WebGL', sinCanvas)

await page.getByRole('button', { name: /Ver el recorrido/ }).click()
await page.waitForTimeout(4000)
const entro = await page.evaluate(() => document.querySelectorAll('canvas').length > 0)
revisar('y al entrar sí aparece el visor 3D', entro)

/* ==========================================================================
 * UN .tour v2 ENTRA CON LA MARCA PUESTA Y LA BASURA FUERA
 * ========================================================================== */
console.log('\n=== Un .tour v2 entra saneado ===')

const SALA = readFileSync('public/panoramas/sala.jpg')
const manifiestoV2 = JSON.parse(readFileSync('tools/pruebas/fixtures/v2.json', 'utf8'))
const v2 = tourito(manifiestoV2, [{ name: 'fotos/sala.jpg', data: SALA }])

await page.goto(`${BASE}#/inicio`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await meterArchivo('v2.tour', v2, 3500)

const v2Guardado = await leerGuardado('Casa de prueba v2')
revisar('el .tour v2 se importa', v2Guardado !== null)
revisar('con sus 2 habitaciones', v2Guardado?.scenes.length === 2)
revisar('la entrada es el patio, no la primera', v2Guardado?.startSceneId === 'patio')

const m = v2Guardado?.marca
revisar('la marca llega con su nombre', m?.nombre === 'Inmobiliaria del Valle')
revisar('y con los colores que sí eran hex', m?.colores?.brand500 === '#7c3aed', JSON.stringify(m?.colores))
revisar('la inyección de CSS se descarta', m?.colores?.ink50 === undefined, String(m?.colores?.ink50))
revisar('un color que no es hex se descarta', m?.colores?.ink900 === undefined, String(m?.colores?.ink900))
revisar('una tipografía fuera de la lista se descarta', m?.tipografia === undefined, String(m?.tipografia))
revisar('el campo desconocido no se copia', m !== undefined && !('campoQueNoExiste' in m))

/* ── El logo de OTRO teléfono ────────────────────────────────────────────
 * `logoId` es una llave del IndexedDB del aparato que exportó. Copiarla al
 * recorrido importado deja un puntero a un blob que en este teléfono no existe:
 * ni logo ni error, solo un hueco. Un campo ausente es honesto; una llave
 * muerta no. */
revisar('un logoId de otro teléfono se ignora', m?.logoId === undefined, String(m?.logoId))

const f = v2Guardado?.ficha
revisar('la ficha llega completa', f?.precio === 'Desde $1.9M' && f?.superficie === '148 m²')
revisar('los enteros se redondean', f?.recamaras === 3 && f?.banos === 2, JSON.stringify([f?.recamaras, f?.banos]))
revisar('el teléfono conserva sus signos', f?.agente?.telefono === '+52 33 2222 3333', String(f?.agente?.telefono))
revisar('el whatsapp queda en dígitos', f?.agente?.whatsapp === '523322223333', String(f?.agente?.whatsapp))

/* ── Un número que llegó como string ────────────────────────────────────
 * `marca` y `ficha` se filtran campo por campo, pero los campos numéricos de la
 * escena entraban tal cual. Un `initialYaw: "90"` se guarda como string,
 * sobrevive a las recargas, y en el rig hace CONCATENACIÓN: `'90' + 0` es
 * `'900'`, o sea que la habitación abre mirando a un yaw que no existe. */
const patio = v2Guardado?.scenes.find((s) => s.name === 'Patio')
revisar(
  'un initialYaw de texto se vuelve número',
  typeof patio?.initialYaw === 'number' && patio.initialYaw === 90,
  `${typeof patio?.initialYaw} ${JSON.stringify(patio?.initialYaw)}`,
)

/* ==========================================================================
 * LA IDA Y VUELTA: lo que el visor escribe, el visor lo vuelve a leer
 *
 * Se hace DENTRO de la página, llamando a las funciones de verdad: `exportarTour`
 * es el único lugar donde `marca` y `ficha` se serializan, y hasta ahora ninguna
 * prueba lo ejecutaba.
 * ========================================================================== */
console.log('\n=== Exportar y volver a importar no pierde nada ===')

const vuelta = await page.evaluate(async (id) => {
  const paquete = await import('/src/lib/store/paquete.ts')
  const zip = await import('/src/lib/store/zip.ts')
  const { blob, nombre } = await paquete.exportarTour(id)
  const dentro = await zip.readZip(blob)
  const crudo = dentro.find((x) => x.name === 'recorrido.json')
  const manifiesto = JSON.parse(new TextDecoder().decode(crudo.data))
  const reimportado = await paquete.importarTour(blob)
  return {
    nombre,
    entradas: dentro.map((x) => x.name),
    manifiesto,
    reimportado: JSON.parse(JSON.stringify(reimportado)),
  }
}, v2Guardado.id)

revisar('el nombre del archivo sale de su título', vuelta.nombre === 'casa-de-prueba-v2.tour', vuelta.nombre)
revisar('el manifiesto sale con version 2', vuelta.manifiesto.version === 2)
revisar('y el ZIP lo lee su propio lector', vuelta.entradas.includes('recorrido.json'))

const CAMPOS_TOUR = ['title', 'subtitle', 'startSceneId', 'createdAt', 'marca', 'ficha']
const distintos = diferencias(v2Guardado, vuelta.reimportado, CAMPOS_TOUR)
revisar('el recorrido vuelve idéntico', distintos.length === 0, distintos.join(', '))

const CAMPOS_ESCENA = ['id', 'name', 'initialYaw', 'hotspots', 'origin', 'coverageDeg', 'createdAt']
const escenasIguales =
  v2Guardado.scenes.length === vuelta.reimportado.scenes.length &&
  v2Guardado.scenes.every(
    (s, i) => diferencias(s, vuelta.reimportado.scenes[i], CAMPOS_ESCENA).length === 0,
  )
revisar(
  'y cada habitación también',
  escenasIguales,
  escenasIguales
    ? ''
    : JSON.stringify(
        v2Guardado.scenes.map((s, i) => diferencias(s, vuelta.reimportado.scenes[i], CAMPOS_ESCENA)),
      ),
)

/* Las fotos SÍ cambian de llave, y tiene que ser así: son blobs nuevos en este
   teléfono. Lo que no puede pasar es que se queden apuntando a las viejas. */
const llavesNuevas = vuelta.reimportado.scenes.every(
  (s, i) => s.imageId && s.imageId !== v2Guardado.scenes[i].imageId,
)
revisar('las fotos se vuelven a guardar con llave nueva', llavesNuevas)

/* Y el recorrido reimportado tiene que ser OTRO, no una sobrescritura: el caso
   real es "me pasaron el recorrido y yo ya tenía mi versión". */
revisar('el recorrido importado es uno nuevo', vuelta.reimportado.id !== v2Guardado.id)

/* ── El logo, ahora sí, viajando ────────────────────────────────────────── */
const logo = await page.evaluate(async (id) => {
  const tours = await import('/src/lib/store/tours.ts')
  const paquete = await import('/src/lib/store/paquete.ts')
  const zip = await import('/src/lib/store/zip.ts')

  // Un PNG de 1×1 transparente: es un logo válido y pesa 68 bytes.
  const png = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  )
  const logoId = await tours.putImage(new Blob([png], { type: 'image/png' }))
  const tour = await tours.getTour(id)
  await tours.saveTour({ ...tour, marca: { ...tour.marca, logoId } })

  const { blob } = await paquete.exportarTour(id)
  const dentro = await zip.readZip(blob)
  const reimportado = await paquete.importarTour(blob)
  const suLogo = reimportado.marca?.logoId
    ? await tours.getImage(reimportado.marca.logoId)
    : null
  return {
    entradas: dentro.map((x) => x.name),
    logoIdViejo: logoId,
    logoIdNuevo: reimportado.marca?.logoId ?? null,
    pesa: suLogo ? suLogo.size : 0,
  }
}, v2Guardado.id)

revisar(
  'el logo viaja dentro del .tour',
  logo.entradas.some((n) => /^marca\/logo\./.test(n)),
  logo.entradas.filter((n) => !n.startsWith('fotos/')).join(', '),
)
revisar('y del otro lado se guarda de nuevo', logo.pesa > 0 && logo.logoIdNuevo !== logo.logoIdViejo, `${logo.pesa} B`)

/* ==========================================================================
 * DOS HABITACIONES CON EL MISMO id
 *
 * El archivo viene de fuera y pudo editarse a mano. La segunda se renombra —eso
 * está bien— pero reescribir TODOS los enlaces que apuntaban a ese id manda a la
 * habitación equivocada a los que apuntaban a la que SÍ conservó el id.
 * ========================================================================== */
console.log('\n=== Un id repetido no desvía los enlaces ===')

const duplicados = tourito(
  {
    formato: 'visor-tour-360',
    version: 2,
    exportadoEn: '2026-03-01T12:00:00.000Z',
    recorrido: {
      id: 'tour-dup',
      title: 'Casa con ids repetidos',
      startSceneId: 'sala',
      createdAt: 1772000000000,
      scenes: [
        {
          id: 'sala',
          name: 'Sala',
          archivo: 'fotos/a.jpg',
          hotspots: [{ id: 'h1', kind: 'link', to: 'cuarto', label: 'Al cuarto', yaw: 0, pitch: 0 }],
          createdAt: 1,
        },
        { id: 'cuarto', name: 'El cuarto de verdad', archivo: 'fotos/a.jpg', hotspots: [], createdAt: 2 },
        { id: 'cuarto', name: 'La bodega colada', archivo: 'fotos/a.jpg', hotspots: [], createdAt: 3 },
      ],
    },
  },
  [{ name: 'fotos/a.jpg', data: SALA }],
)

await page.goto(`${BASE}#/inicio`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await meterArchivo('dup.tour', duplicados, 3500)

const dup = await leerGuardado('Casa con ids repetidos')
const destino = dup?.scenes.find((s) => s.id === dup.scenes[0].hotspots[0].to)
revisar('las 3 habitaciones entran', dup?.scenes.length === 3)
revisar('los ids quedan únicos', new Set(dup?.scenes.map((s) => s.id)).size === 3)
revisar(
  'y la puerta sigue llevando al cuarto',
  destino?.name === 'El cuarto de verdad',
  `abre en "${destino?.name}"`,
)
revisar('la entrada también', dup?.startSceneId === 'sala')

/* ==========================================================================
 * A UNA HABITACIÓN LE FALTA SU FOTO
 *
 * El `.tour` existe porque Safari borra el almacenamiento. En ese escenario, el
 * respaldo que salvaría las fotos que sí quedan no puede negarse en bloque y
 * llevarse cero: los dos lectores omiten la habitación y siguen, y el escritor
 * tiene que ser igual de tolerante.
 * ========================================================================== */
console.log('\n=== Exportar con una foto perdida salva el resto ===')

const perdida = await page.evaluate(async (titulo) => {
  const tours = await import('/src/lib/store/tours.ts')
  const paquete = await import('/src/lib/store/paquete.ts')
  const zip = await import('/src/lib/store/zip.ts')
  const lista = await tours.listTours()
  const id = lista.find((x) => x.title === titulo).id
  const tour = await tours.getTour(id)

  // Se borra el blob de la PRIMERA habitación, como lo haría el navegador.
  await tours.deleteImage(tour.scenes[0].imageId)

  try {
    const { blob } = await paquete.exportarTour(id)
    const dentro = await zip.readZip(blob)
    const man = JSON.parse(new TextDecoder().decode(dentro.find((x) => x.name === 'recorrido.json').data))
    return { ok: true, escenas: man.recorrido.scenes.map((s) => s.name), fotos: dentro.filter((x) => x.name.startsWith('fotos/')).length }
  } catch (e) {
    return { ok: false, mensaje: String(e && e.message) }
  }
}, 'Casa con ids repetidos')

revisar('exporta lo que sí quedó', perdida.ok === true, perdida.ok ? perdida.escenas.join(', ') : perdida.mensaje)
revisar('sin la habitación que perdió su foto', perdida.ok && perdida.escenas.length === 2)

/* Y cuando NO queda ninguna foto, sí es un error duro: es el mismo criterio que
   ya usa la importación, y un archivo con cero habitaciones no es un respaldo. */
const sinNinguna = await page.evaluate(async (titulo) => {
  const tours = await import('/src/lib/store/tours.ts')
  const paquete = await import('/src/lib/store/paquete.ts')
  const lista = await tours.listTours()
  const id = lista.find((x) => x.title === titulo).id
  const tour = await tours.getTour(id)
  for (const s of tour.scenes) await tours.deleteImage(s.imageId)
  try {
    await paquete.exportarTour(id)
    return 'no falló'
  } catch (e) {
    return String(e && e.message)
  }
}, 'Casa con ids repetidos')
revisar('y sin ninguna foto sí avisa', /ninguna foto|ninguna habitación/i.test(sinNinguna), sinNinguna)

/* ==========================================================================
 * ARCHIVOS HOSTILES: cada uno tiene que dar un MENSAJE, no una pantalla negra
 * ========================================================================== */
console.log('\n=== Un archivo roto da mensaje, no pantalla negra ===')

const base = () => ({
  formato: 'visor-tour-360',
  version: 2,
  exportadoEn: '2026-03-01T12:00:00.000Z',
  recorrido: { id: 'x', title: 'X', startSceneId: 's', createdAt: 1, scenes: [] },
})
const conEscena = (extra) => {
  const m = base()
  m.recorrido.scenes = [{ id: 's', name: 'S', archivo: 'fotos/s.jpg', hotspots: [], createdAt: 1 }]
  return Object.assign(m, extra)
}

const hostiles = [
  /* El mensaje que sale es el de `readZip`, que `PaqueteError` deja pasar tal
     cual. Eso está bien —dice más que "no se pudo leer"— y la primera versión de
     esta línea lo daba por fallo por haber adivinado el texto en vez de leerlo. */
  ['no es un ZIP', Buffer.from('esto no es un zip, ni de casualidad'), /no parece un ZIP|no se pudo leer/i],
  ['ZIP sin manifiesto', zipito([{ name: 'foto.jpg', data: SALA.subarray(0, 64) }]), /manifiesto/i],
  ['manifiesto que no es JSON', zipito([{ name: 'recorrido.json', data: Buffer.from('{ roto') }]), /dañado|no se entendió/i],
  ['hecho por otro programa', tourito({ ...conEscena({}), formato: 'otro-programa' }), /otro programa/i],
  ['de una versión más nueva', tourito(conEscena({ version: 99 })), /versión más nueva/i],
  ['sin lista de habitaciones', tourito({ ...base(), recorrido: { ...base().recorrido, scenes: 'ninguna' } }), /no trae habitaciones/i],
  ['con la foto que no está en el ZIP', tourito(conEscena({})), /ninguna foto/i],
  ['un ZIP vacío', zipito([]), /manifiesto/i],
]

const antes = await page.evaluate(async () => (await import('/src/lib/store/tours.ts')).listTours().then((l) => l.length))

for (const [que, buffer, esperado] of hostiles) {
  const mensaje = await page.evaluate(async (b64) => {
    const paquete = await import('/src/lib/store/paquete.ts')
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    try {
      await paquete.importarTour(new Blob([bytes]))
      return 'NO FALLÓ'
    } catch (e) {
      return e && e.name === 'PaqueteError' ? e.message : `${e && e.name}: ${e && e.message}`
    }
  }, Buffer.from(buffer).toString('base64'))
  revisar(que, esperado.test(mensaje), mensaje)
}

const despues = await page.evaluate(async () => (await import('/src/lib/store/tours.ts')).listTours().then((l) => l.length))
revisar('y ninguno dejó un recorrido a medias', antes === despues, `${antes} → ${despues}`)

/* Uno de ellos, además, por la interfaz de verdad: lo que importa no es que la
   función lance, es que el agente vea el aviso. */
await page.goto(`${BASE}#/inicio`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await meterArchivo('roto.tour', Buffer.from('esto no es un zip'), 2500)
const aviso = await page.getByText(/Algo salió mal/).isVisible().catch(() => false)
revisar('el aviso aparece en la pantalla', aviso)

/* ==========================================================================
 * SEGURIDAD: un .tour ajeno se abre en el telefono de un COMPRADOR.
 *
 * La portada interpola los datos de contacto dentro de `href`. Un archivo
 * preparado a mano metia un BCC en el `mailto:` —comprobado leyendo el DOM— y
 * cadenas MMI en el `tel:`. Se sanean en limpiarFicha, en la frontera, y aqui se
 * comprueba que la frontera aguanta por el camino REAL del importador.
 * ========================================================================== */
console.log('\n=== Un .tour ajeno no puede inyectar en los enlaces ===')

const maliciosos = [
  ['BCC en el mailto', { correo: 'cliente@casa.mx?subject=Confirma&bcc=espia@mal.mx' }, 'correo'],
  ['MMI en el tel', { telefono: '*21*5551234#' }, 'telefono'],
  ['javascript: en el correo', { correo: 'javascript:alert(1)' }, 'correo'],
  ['salto de linea en el correo', { correo: 'a@b.mx\nbcc:x@y.mx' }, 'correo'],
]
const limpio = await page.evaluate(async (casos) => {
  const salida = []
  for (const [, agente] of casos) {
    // Se pasa por el MISMO filtro que usa el importador.
    const mod = await import('/src/lib/store/migrar.ts')
    salida.push(mod.limpiarFicha({ precio: '$1', agente })?.agente ?? null)
  }
  return salida
}, maliciosos)

maliciosos.forEach(([que, , campoMalo], i) => {
  const r = limpio[i]
  const valor = r?.[campoMalo]
  /* La unica respuesta correcta es rechazarlo, o dejarlo sin los caracteres que
     le daban el significado peligroso. Nunca pasarlo tal cual. */
  const seguro =
    valor === undefined ||
    (!/[?&#\n\r,;]/.test(String(valor)) && !/^javascript:/i.test(String(valor)))
  console.log(`  ${que.padEnd(30)} ${(seguro ? 'contenido' : 'PASA TAL CUAL').padEnd(14)} ${JSON.stringify(valor)}`)
  if (!seguro) bien = false
})

console.log(`\n${bien ? 'EL FORMATO AGUANTA' : 'HAY ALGO MAL'}`)
console.log('errores de consola:', errores.length ? errores : 'ninguno')
await browser.close()
process.exit(bien && errores.length === 0 ? 0 : 1)

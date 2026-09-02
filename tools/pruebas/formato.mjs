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
revisar('el modo kiosco llega del archivo', v2Guardado?.autogiro === true, String(v2Guardado?.autogiro))

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
 * LA PORTADA CON UNA DESCRIPCIÓN LARGA
 *
 * El fixture trae una descripción de 400 caracteres, que es lo normal en un
 * anuncio de verdad, y con eso el contenido de la portada DESBORDA en un
 * teléfono. Ahí aparece el defecto: la foto de fondo y el degradado son hijos
 * absolutos del mismo contenedor que hace scroll, así que se van con él y la
 * mitad de abajo queda sin fondo — el texto blanco sobre el gris de la app.
 *
 * Se mide la posición del `<img>` de fondo después de bajar hasta el final: si
 * sigue cubriendo la pantalla, está bien puesto.
 *
 * ── Y por qué esta parte se mide en un iPhone SE ──────────────────────────
 *
 * Porque en un teléfono grande NO desborda: medido, en 390×844 el contenido cabe
 * con 400 caracteres de descripción y la prueba no probaría nada. A 375×667 —el
 * mismo aparato que `tactil.mjs` usa como referencia del proyecto— sobran 58 px
 * y el defecto aparece. Un caso de borde que solo existe en la pantalla chica
 * sigue siendo un caso: es donde vive la mitad del mercado al que se le vende.
 * ========================================================================== */
console.log('\n=== La portada con una descripción larga ===')

await page.setViewportSize({ width: 375, height: 667 })
await page.goto(`${BASE}#/ver/${v2Guardado.id}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

const portada = await page.evaluate(async () => {
  const alto = window.innerHeight
  /* El contenedor que hace scroll: el que de verdad tiene desbordamiento, no el
     que uno cree. Se busca desde el fondo del árbol para no confundirlo con
     `document.scrollingElement`, que en esta app no scrollea. */
  const cajas = [...document.querySelectorAll('div')].filter(
    (d) => d.scrollHeight > d.clientHeight + 8 && d.clientHeight > alto / 2,
  )
  const caja = cajas[0]
  if (!caja) return { desborda: false }

  caja.scrollTop = caja.scrollHeight
  await new Promise((listo) => requestAnimationFrame(() => requestAnimationFrame(listo)))

  const img = document.querySelector('img[aria-hidden="true"]')
  const r = img ? img.getBoundingClientRect() : null
  return {
    desborda: true,
    sobra: caja.scrollHeight - caja.clientHeight,
    arriba: r ? Math.round(r.top) : null,
    abajo: r ? Math.round(r.bottom) : null,
    alto,
  }
})

revisar(
  'el contenido desborda, como en un anuncio real',
  portada.desborda === true,
  portada.desborda ? `${portada.sobra} px de más` : 'no desbordó: la prueba no prueba nada',
)
revisar(
  'y la foto de fondo sigue cubriendo abajo',
  portada.desborda && portada.arriba !== null && portada.arriba <= 0 && portada.abajo >= portada.alto,
  `img de ${portada.arriba} a ${portada.abajo}, pantalla ${portada.alto}`,
)

await page.setViewportSize({ width: 390, height: 844 })

/* ==========================================================================
 * Y EN PANTALLA: "N" solo cuando de verdad se sabe dónde está el norte
 *
 * Una foto importada no trae dato de brújula, y ahí el disco NO puede decir "N":
 * el frente de esa panorámica es donde el agente tenía el teléfono, no el norte.
 * Dice "frente", que es la verdad y sigue sirviendo para saber cuánto se giró.
 * Una brújula que miente vale menos que ninguna.
 * ========================================================================== */
console.log('\n=== El disco solo dice "N" cuando lo sabe ===')

const idV1 = (await leerGuardado('Casa de prueba v1')).id

const discoDe = async (id) => {
  await page.goto(`${BASE}#/ver/${id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2200)
  const entrar = page.getByRole('button', { name: /Ver el recorrido/ })
  if (await entrar.isVisible().catch(() => false)) {
    await entrar.click()
    await page.waitForTimeout(3500)
  }
  return page.evaluate(() => {
    /* Acotado a la brújula: `.will-change-transform` a secas también lo llevan
       los marcadores de los enlaces, y la primera versión de esta línea leía un
       marcador —devolvía "→" y un `translate3d`— y daba tres fallos que no
       existían. El disco es el hijo del único `hud-glass` redondo. */
    const discos = document.querySelectorAll('.hud-glass.rounded-full .will-change-transform')
    const disco = discos[0]
    const etiqueta = disco?.firstElementChild
    return {
      cuantos: discos.length,
      arriba: etiqueta?.textContent ?? null,
      giro: disco instanceof HTMLElement ? disco.style.transform : null,
      /* "frente" es más ancho que "N", y el disco mide 52 px. Se mide en vez de
         suponerlo: una etiqueta que se sale del vidrio se ve como un defecto de
         maquetación, y el ancho depende de la fuente del sistema. */
      cabe: etiqueta && disco
        ? etiqueta.getBoundingClientRect().width <= disco.getBoundingClientRect().width
        : null,
      ancho: etiqueta ? Math.round(etiqueta.getBoundingClientRect().width) : null,
      disco: disco ? Math.round(disco.getBoundingClientRect().width) : null,
    }
  })
}

const conRumbo = await discoDe(v2Guardado.id)
revisar('hay una sola brújula en pantalla', conRumbo.cuantos === 1, `${conRumbo.cuantos}`)
revisar('con rumbo el disco dice N', conRumbo.arriba === 'N', JSON.stringify(conRumbo))
/* Y el disco está GIRADO, no en cero: el frente de esta panorámica mira al
   rumbo 40, así que el norte no puede quedar arriba. */
revisar(
  'y el disco no apunta al frente de la foto',
  /rotate\(-?\d/.test(conRumbo.giro ?? '') && !/rotate\(-?0(\.0+)?deg\)/.test(conRumbo.giro ?? ''),
  String(conRumbo.giro),
)

const sinRumbo = await discoDe(idV1)
revisar('sin rumbo dice "frente"', sinRumbo.arriba === 'frente', JSON.stringify(sinRumbo))
revisar(
  'y "frente" cabe dentro del disco',
  sinRumbo.cabe === true,
  `${sinRumbo.ancho} px de ${sinRumbo.disco}`,
)

/* ==========================================================================
 * LA BARRA DEL NAVEGADOR TAMBIÉN ES DE LA MARCA
 *
 * `theme-color` no es una propiedad de CSS sino un `<meta>`, así que reasignar
 * tokens no lo mueve: se quedaba con el valor de `index.html`. En un iPhone eso
 * es la franja de arriba y la de abajo alrededor de la página, o sea que el
 * recorrido de una inmobiliaria morada se enmarcaba en el color del visor de
 * otra — el borde que más se nota, porque no es parte del diseño de nadie.
 * ========================================================================== */
console.log('\n=== La barra del navegador sigue a la marca ===')

const barra = async () =>
  page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.content ?? null)

/* Se ESPERA el valor en vez de dormir un rato fijo. La marca se aplica en un
   efecto, después de leer el recorrido de IndexedDB, así que un `waitForTimeout`
   es una apuesta: la primera versión de esto pasaba sola y empezó a fallar en
   cuanto le puse delante una sección que deja un contexto WebGL abierto —este
   contenedor renderiza por software y todo lo de después se vuelve más lento—.
   Un fallo por timing en una prueba que mide otra cosa cuesta más que el rato
   que se ahorra. */
const esperarBarra = async (valor) => {
  await page
    .waitForFunction(
      (v) => document.querySelector('meta[name="theme-color"]')?.content === v,
      valor,
      { timeout: 10000 },
    )
    .catch(() => {})
  return barra()
}

await page.goto(`${BASE}#/inicio`, { waitUntil: 'networkidle' })
const barraSinMarca = await esperarBarra('#0b0f19')
await page.goto(`${BASE}#/ver/${v2Guardado.id}`, { waitUntil: 'networkidle' })
const barraConMarca = await esperarBarra('#0a0a12')
await page.goto(`${BASE}#/inicio`, { waitUntil: 'networkidle' })
const barraTrasSalir = await esperarBarra('#0b0f19')

/* El fondo del `body` y no el acento: esta franja tiene que DESAPARECER contra
   la página, no resaltar. Se comprueba que sean el mismo color. */
revisar('sin marca es el fondo de la app', barraSinMarca === '#0b0f19', String(barraSinMarca))
revisar('con marca toma su fondo', barraConMarca === '#0a0a12', String(barraConMarca))
revisar('y al salir vuelve', barraTrasSalir === '#0b0f19', String(barraTrasSalir))

/* ==========================================================================
 * DOS RECORRIDOS SEGUIDOS: EL SEGUNDO TAMBIÉN TIENE PORTADA
 *
 * `VisorGuardado` guarda en estado el recorrido y si la persona ya entró. Al
 * navegar de `#/ver/A` a `#/ver/B` React lo mantiene montado —misma posición del
 * árbol— así que los dos estados se quedaban con lo de A: B se abría SIN
 * portada, saltándose el precio y el contacto, que es la pantalla que vende.
 *
 * Es el caso del agente enseñando dos casas a un cliente que tiene al lado, o
 * sea el uso para el que existe la portada.
 * ========================================================================== */
console.log('\n=== El segundo recorrido también tiene portada ===')

await page.goto(`${BASE}#/ver/${idV1}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2200)
await page.getByRole('button', { name: /Ver el recorrido/ }).click()
await page.waitForTimeout(3500)
const entroEnElPrimero = await page.evaluate(() => document.querySelectorAll('canvas').length > 0)
revisar('se entra al primero', entroEnElPrimero)

/* Sin recargar la página: se cambia el hash, que es lo que hace la app. */
await page.evaluate((id) => {
  location.hash = `#/ver/${id}`
}, v2Guardado.id)
await page.waitForTimeout(2500)
const enElSegundo = {
  hash: await page.evaluate(() => location.hash),
  portada: await page.getByRole('button', { name: /Ver el recorrido/ }).isVisible().catch(() => false),
  precio: await page.getByText('Desde $1.9M').first().isVisible().catch(() => false),
}
revisar('el hash cambió al segundo', enElSegundo.hash === `#/ver/${v2Guardado.id}`, enElSegundo.hash)
revisar('y el segundo muestra SU portada', enElSegundo.portada && enElSegundo.precio)

/* ==========================================================================
 * UNA MARCA QUE DEJARÍA EL VISOR ILEGIBLE
 *
 * `#111111` es un hex perfectamente válido, y como `ink50` deja la portada a
 * 1.01 de contraste: texto casi negro sobre el fondo casi negro de la app. No
 * hace falta mala fe — una inmobiliaria que llene "ink" pensando "tinta =
 * oscuro" produce exactamente eso.
 *
 * La paleta se descarta COMPLETA y no el token culpable, porque media marca
 * mezclada con medio tema base da algo peor que cualquiera de las dos. El
 * nombre sobrevive: no pinta nada encima de nada.
 * ========================================================================== */
console.log('\n=== Una marca ilegible no entra ===')

const ilegible = tourito(
  {
    formato: 'visor-tour-360',
    version: 2,
    exportadoEn: '2026-03-01T12:00:00.000Z',
    recorrido: {
      id: 'tour-ciego',
      title: 'Casa con marca ciega',
      startSceneId: 'sala',
      createdAt: 1772000000000,
      marca: {
        nombre: 'Tinta Oscura S.A.',
        colores: { ink50: '#111111', ink200: '#161616', brand500: '#0d0d0d' },
        fondoApp: '#0a0a0a',
      },
      ficha: { precio: '$1' },
      scenes: [{ id: 'sala', name: 'Sala', archivo: 'fotos/a.jpg', hotspots: [], createdAt: 1 }],
    },
  },
  [{ name: 'fotos/a.jpg', data: SALA }],
)

await page.goto(`${BASE}#/inicio`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await meterArchivo('ciega.tour', ilegible, 3500)

const ciega = await leerGuardado('Casa con marca ciega')
revisar('el recorrido entra igual', ciega !== null)
revisar('la paleta ilegible se descarta entera', ciega?.marca?.colores === undefined, JSON.stringify(ciega?.marca?.colores))
revisar('y su fondo también', ciega?.marca?.fondoApp === undefined, String(ciega?.marca?.fondoApp))
revisar('el nombre de la inmobiliaria se queda', ciega?.marca?.nombre === 'Tinta Oscura S.A.')

/* Y lo que de verdad importa: que en pantalla se lea. Se mide el contraste real
   entre el color del texto y el fondo, con los píxeles que reporta el navegador,
   no las variables de CSS. */
await page.goto(`${BASE}#/ver/${ciega.id}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
const legible = await page.evaluate(() => {
  const cuerpo = getComputedStyle(document.body)
  const rgb = (s) => (s.match(/\d+/g) ?? []).slice(0, 3).map(Number)
  const lum = ([r, g, b]) =>
    [r, g, b]
      .map((c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4)))
      .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
  const [a, b] = [lum(rgb(cuerpo.color)), lum(rgb(cuerpo.backgroundColor))]
  const [claro, oscuro] = a > b ? [a, b] : [b, a]
  return { razon: (claro + 0.05) / (oscuro + 0.05), color: cuerpo.color, fondo: cuerpo.backgroundColor }
})
revisar(
  'la portada se lee en pantalla',
  legible.razon >= 4.5,
  `${legible.razon.toFixed(2)}:1 · ${legible.color} sobre ${legible.fondo}`,
)

/* ==========================================================================
 * EL NORTE DE VERDAD, DESDE EL ARCHIVO HASTA LA BRÚJULA
 *
 * `rumbo` es el rumbo real al que mira el frente de la panorámica. Se calculaba
 * en cada captura y se tiraba: `offsetNorte` no lo leía nadie en todo `src/`, así
 * que la brújula del visor ponía su "N" en el frente arbitrario de la foto.
 *
 * La geometría y el signo se prueban en `tools/pruebas/rumbo.mjs`, sin
 * navegador. Aquí se prueba lo otro: que el número CRUCE toda la cadena —archivo,
 * saneado, IndexedDB, el visor— y que llegue al disco.
 * ========================================================================== */
console.log('\n=== El rumbo llega del archivo a la brújula ===')

const rumbos = v2Guardado.scenes.map((e) => e.rumbo)
revisar('el rumbo de la sala se conserva', rumbos[0] === 70, JSON.stringify(rumbos))
/* La segunda escena lo trae como texto Y fuera del círculo (`"400"`): 400 y 40
   son el mismo rumbo, así que se normaliza en vez de rechazarse. Lo que no se
   acepta es que no sea un número, porque entonces la brújula diría "N"
   apuntando a cualquier lado. */
revisar('un "400" de texto se vuelve 40', rumbos[1] === 40, `${typeof rumbos[1]} ${rumbos[1]}`)

/* Y el nivel, que también es un par de números que viene de fuera: se acota a
   ±15 en vez de rechazarse, se acepta como texto si es un número, y cero en los
   dos ejes es lo mismo que ninguno. */
const niveles = v2Guardado.scenes.map((e) => e.nivel)
revisar(
  'el nivel de la sala se conserva',
  niveles[0]?.tiltX === 2 && niveles[0]?.tiltZ === -1.5,
  JSON.stringify(niveles[0]),
)
revisar(
  'un nivel con texto y fuera de rango se normaliza',
  niveles[1]?.tiltX === 3 && niveles[1]?.tiltZ === 15,
  JSON.stringify(niveles[1]),
)
const nivelesMalos = await page.evaluate(async () => {
  const mod = await import('/src/lib/store/migrar.ts')
  const base = { id: 'a', name: 'A', archivo: 'x.jpg' }
  return [
    mod.limpiarEscena({ ...base, nivel: { tiltX: 0, tiltZ: 0 } })?.nivel,
    mod.limpiarEscena({ ...base, nivel: { tiltX: 2 } })?.nivel,
    mod.limpiarEscena({ ...base, nivel: 'plano' })?.nivel,
  ]
})
revisar('cero, a medias o basura: sin nivel', nivelesMalos.every((n) => n === undefined), JSON.stringify(nivelesMalos))

const conBrujula = await page.evaluate(async () => {
  const mod = await import('/src/lib/store/migrar.ts')
  return [
    mod.limpiarEscena({ id: 'a', name: 'A', archivo: 'x.jpg', rumbo: 'norte' })?.rumbo,
    mod.limpiarEscena({ id: 'a', name: 'A', archivo: 'x.jpg', rumbo: null })?.rumbo,
    mod.limpiarEscena({ id: 'a', name: 'A', archivo: 'x.jpg' })?.rumbo,
  ]
})
revisar(
  'un rumbo que no es número no se guarda',
  conBrujula.every((r) => r === undefined),
  JSON.stringify(conBrujula),
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
    /* El tamaño de cada foto guardada de nuevo. Con solo comparar las llaves,
       la aserción no podía fallar nunca —`newId()` siempre devuelve una nueva—,
       o sea que era de las que se leen bien y no prueban nada. Lo que de verdad
       importa es que la foto ESTÉ bajo la llave nueva. */
    pesos: await Promise.all(
      reimportado.scenes.map(async (s) => {
        const b = await (await import('/src/lib/store/tours.ts')).getImage(s.imageId)
        return b ? b.size : 0
      }),
    ),
  }
}, v2Guardado.id)

revisar('el nombre del archivo sale de su título', vuelta.nombre === 'casa-de-prueba-v2.tour', vuelta.nombre)
revisar('el manifiesto sale con version 2', vuelta.manifiesto.version === 2)
revisar('y el ZIP lo lee su propio lector', vuelta.entradas.includes('recorrido.json'))

const CAMPOS_TOUR = ['title', 'subtitle', 'startSceneId', 'createdAt', 'marca', 'ficha', 'autogiro']
const distintos = diferencias(v2Guardado, vuelta.reimportado, CAMPOS_TOUR)
revisar('el recorrido vuelve idéntico', distintos.length === 0, distintos.join(', '))

const CAMPOS_ESCENA = ['id', 'name', 'initialYaw', 'hotspots', 'origin', 'coverageDeg', 'rumbo', 'nivel', 'createdAt']
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
   teléfono. Lo que no puede pasar es que se queden apuntando a las viejas ni que
   la llave nueva no tenga nada detrás. */
const llavesNuevas = vuelta.reimportado.scenes.every(
  (s, i) => s.imageId && s.imageId !== v2Guardado.scenes[i].imageId,
)
revisar(
  'las fotos se vuelven a guardar con llave nueva',
  llavesNuevas && vuelta.pesos.every((n) => n > 0),
  vuelta.pesos.join(' / ') + ' B',
)

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
 * LA ESTAMPA DE VERSIÓN EN INDEXEDDB
 *
 * El `.tour` trae `version` en su manifiesto desde el principio; los registros
 * de IndexedDB no traían nada. Y el `.tour` es el RESPALDO: el trabajo real vive
 * en IndexedDB, o sea que faltaba justo donde más importa. Cuando llegue la v3,
 * los archivos suben por su peldaño y los cuarenta recorridos del teléfono del
 * agente no suben por ninguno.
 * ========================================================================== */
console.log('\n=== Todo lo que se guarda lleva su versión ===')

const estampas = await page.evaluate(async () => {
  const tours = await import('/src/lib/store/tours.ts')
  const idb = await import('/src/lib/store/idb.ts')
  const lista = await tours.listTours()

  // Todos los que hay ahora: unos entraron por el importador, otros por saveTour.
  const todos = await idb.tx([idb.STORE_TOURS], 'readonly', (t) =>
    idb.idbGetAll(t, idb.STORE_TOURS),
  )

  /* Y un registro VIEJO, escrito a mano sin estampa, como los que ya están en
     el teléfono de quien usó la app antes de este cambio. Tiene que leerse. */
  const viejo = { ...(await tours.getTour(lista[0].id)), id: 'tour-sin-estampa' }
  delete viejo.formato
  await idb.tx([idb.STORE_TOURS], 'readwrite', (t) => idb.idbPut(t, idb.STORE_TOURS, viejo))
  const leido = await tours.getTour('tour-sin-estampa')

  // Y que al volver a guardarlo sí quede estampado.
  const reguardado = await tours.saveTour(leido)

  return {
    total: todos.length,
    conEstampa: todos.filter((t) => t.formato === 2).length,
    sinEstampaSeLee: leido !== null && leido.scenes.length > 0,
    trasReguardar: reguardado.formato,
  }
})

revisar(
  'cada recorrido guardado trae formato: 2',
  estampas.total > 0 && estampas.conEstampa === estampas.total,
  `${estampas.conEstampa} de ${estampas.total}`,
)
revisar('uno viejo sin estampa se sigue leyendo', estampas.sinEstampaSeLee)
revisar('y al reguardarlo queda estampado', estampas.trasReguardar === 2, String(estampas.trasReguardar))

/* Esta sección va AQUÍ a propósito, y las dos vecinas fijan el sitio: edita el
   recorrido v2 en IndexedDB, así que va DESPUÉS de la ida y vuelta —que compara
   ese recorrido con lo que se importó; puesta antes reportaba "hotspots, nivel"
   distintos, que eran los cambios de esta prueba y no un defecto— y ANTES de
   "Preparar el archivo", que le borra la foto a la sala para probar el aviso de
   habitación fuera: sin foto no hay canvas, y esta prueba necesita el editor. */
/* ==========================================================================
 * EL NIVEL SE AJUSTA EN EL EDITOR Y LOS PUNTOS SIGUEN A LA FOTO
 *
 * La matemática —qué rotación endereza qué ladeo, y con qué signo— la prueba
 * `tools/pruebas/nivel.mjs` sin navegador. Aquí se prueba el cableado: que el
 * control del editor escriba `nivel` en el recorrido, que al cerrar se guarde en
 * IndexedDB, y que los puntos se muevan exactamente como dice `corregirPunto`
 * para seguir sobre el mismo detalle de la foto. Se compara contra la función
 * real, importada, no contra un número escrito a mano.
 * ========================================================================== */
console.log('\n=== El nivel se ajusta en el editor ===')

await page.goto(`${BASE}#/puntos/${v2Guardado.id}/sala`, { waitUntil: 'networkidle' })
try {
  await page.waitForSelector('canvas', { timeout: 20000 })
} catch (e) {
  /* Un "timeout" a secas no dice nada: qué había en pantalla, sí. */
  const texto = await page.locator('body').innerText().catch(() => '(sin texto)')
  console.log(`  sin canvas en ${page.url()}\n  en pantalla: ${texto.slice(0, 400).replace(/\n+/g, ' | ')}`)
  console.log(`  errores hasta aquí: ${JSON.stringify(errores)}`)
  throw e
}
await page.waitForTimeout(2500)
const salaAntes = (await leerGuardado('Casa de prueba v2')).scenes.find((e) => e.id === 'sala')
await page.getByRole('button', { name: 'Nivel' }).click()
await page.waitForTimeout(500)
/* `fill` sobre un range fija el valor y dispara `input`/`change`, como el dedo. */
await page.getByRole('slider', { name: 'Adelante y atrás' }).fill('5')
await page.waitForTimeout(400)
await page.getByRole('slider', { name: 'Izquierda y derecha' }).fill('-2.5')
await page.waitForTimeout(400)
const enPantalla = await page.evaluate(() =>
  [...document.querySelectorAll('input[type=range]')].map((i) => i.value),
)
await page.getByRole('button', { name: 'Listo' }).click()
await page.waitForTimeout(1500)

const salaDespues = (await leerGuardado('Casa de prueba v2')).scenes.find((e) => e.id === 'sala')
revisar('los controles muestran lo que se movió', enPantalla.join('/') === '5/-2.5', enPantalla.join('/'))
revisar(
  'al cerrar, el nivel queda guardado',
  salaDespues?.nivel?.tiltX === 5 && salaDespues?.nivel?.tiltZ === -2.5,
  JSON.stringify(salaDespues?.nivel),
)

/* Los puntos: cada uno tiene que estar donde `corregirPunto` dice que queda el
   mismo detalle de la foto con el nivel nuevo, partiendo del nivel que tenía. */
const puntos = await page.evaluate(
  async ({ antes, despues }) => {
    const { corregirPunto } = await import('/src/lib/nivel.ts')
    const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180
    return antes.hotspots.map((h, i) => {
      const c = corregirPunto(h.yaw, h.pitch, antes.nivel, despues.nivel)
      const real = despues.hotspots[i]
      return {
        id: h.id,
        desvio: Math.max(Math.abs(wrap180(real.yaw - c.yaw)), Math.abs(real.pitch - c.pitch)),
        seMovio: Math.abs(wrap180(real.yaw - h.yaw)) + Math.abs(real.pitch - h.pitch),
      }
    })
  },
  { antes: salaAntes, despues: salaDespues },
)
revisar(
  'los puntos siguen a la foto, como dice corregirPunto',
  puntos.length === 2 && puntos.every((p) => p.desvio < 1e-6),
  puntos.map((p) => `${p.id} desvío ${p.desvio.toExponential(1)}`).join(' · '),
)
revisar('y de verdad se movieron', puntos.every((p) => p.seMovio > 0.5), puntos.map((p) => `${p.id} ${p.seMovio.toFixed(2)}°`).join(' · '))

/* "Quitar nivel" NO devuelve los puntos a donde estaban: la sala del fixture
   traía nivel (2, -1.5), y sin nivel la foto se muestra SIN enderezar, así que
   los puntos tienen que irse con ella para seguir sobre el mismo detalle. La
   primera versión de esta aserción esperaba los puntos del fixture y estaba mal
   —el producto hacía lo correcto—. Lo que sí tiene que ser exacto es volver a
   PONER el nivel del fixture: tres cambios de nivel encadenados tienen que
   dejar cada punto donde empezó, o `corregirPunto` acumula error. */
await page.getByRole('button', { name: 'Nivel' }).click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Quitar nivel' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Listo' }).click()
await page.waitForTimeout(1500)
const salaQuitada = (await leerGuardado('Casa de prueba v2')).scenes.find((e) => e.id === 'sala')
revisar('quitar el nivel lo borra', salaQuitada?.nivel === undefined, JSON.stringify(salaQuitada?.nivel))
const siguenSinNivel = await page.evaluate(
  async ({ antes, despues }) => {
    const { corregirPunto } = await import('/src/lib/nivel.ts')
    const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180
    return antes.hotspots.every((h, i) => {
      const c = corregirPunto(h.yaw, h.pitch, antes.nivel, undefined)
      const r = despues.hotspots[i]
      return Math.abs(wrap180(r.yaw - c.yaw)) < 1e-6 && Math.abs(r.pitch - c.pitch) < 1e-6
    })
  },
  { antes: salaAntes, despues: salaQuitada },
)
revisar('y los puntos siguen a la foto sin nivel', siguenSinNivel)

await page.getByRole('button', { name: 'Nivel' }).click()
await page.waitForTimeout(500)
await page.getByRole('slider', { name: 'Adelante y atrás' }).fill(String(salaAntes.nivel.tiltX))
await page.waitForTimeout(300)
await page.getByRole('slider', { name: 'Izquierda y derecha' }).fill(String(salaAntes.nivel.tiltZ))
await page.waitForTimeout(300)
await page.getByRole('button', { name: 'Listo' }).click()
await page.waitForTimeout(1500)
const salaVuelta = (await leerGuardado('Casa de prueba v2')).scenes.find((e) => e.id === 'sala')
/* El yaw se compara MÓDULO una vuelta: el importador guarda 200 (wrap360) y el
   editor escribe -160 (wrap180). Es la misma dirección, y sin envolver esta
   aserción daba 360° de "desvío" en un punto que no se había movido. */
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180
const peorVuelta = Math.max(
  ...salaAntes.hotspots.map((h, i) => {
    const r = salaVuelta.hotspots[i]
    return Math.max(Math.abs(wrap180(r.yaw - h.yaw)), Math.abs(r.pitch - h.pitch))
  }),
)
revisar(
  'volver al nivel original devuelve los puntos exactos',
  JSON.stringify(salaVuelta?.nivel) === JSON.stringify(salaAntes.nivel) && peorVuelta < 1e-6,
  `peor desvío ${peorVuelta.toExponential(1)}° tras tres cambios`,
)

/* ==========================================================================
 * "PREPARAR ARCHIVO" Y "COMPARTIR", POR LA INTERFAZ
 *
 * Los dos botones del editor, en el orden real de dos toques. Importa
 * probarlos por aquí y no llamando funciones: el escritor de `.tour` se baja con
 * `import()` para no pesar en el arranque, y `entregarArchivo` NO —en iOS un
 * `await` gasta la activación del toque y la hoja de compartir no aparece—. Esa
 * asimetría es exactamente el tipo de cosa que se rompe en un refactor y que solo
 * se nota en un teléfono.
 *
 * En Chromium no hay `canShare` de archivos, así que cae en la descarga, que es
 * el respaldo declarado. Se comprueba que la descarga ocurra y con qué nombre.
 * ========================================================================== */
console.log('\n=== Preparar el archivo y compartirlo ===')

await page.goto(`${BASE}#/editar/${v2Guardado.id}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

await page.getByRole('button', { name: 'Preparar archivo' }).click()
const compartir = page.getByRole('button', { name: /^Compartir / })
/* `waitFor` y no `isVisible({timeout})`: `isVisible` responde en el instante, sin
   esperar, así que el `timeout` no hace nada — la primera versión de esta línea
   daba "NO" mientras el ZIP se estaba armando, y la descarga de abajo pasaba. Un
   arnés que pregunta antes de tiempo reporta un fallo que no existe. */
const armo = await compartir
  .waitFor({ state: 'visible', timeout: 20000 })
  .then(() => true)
  .catch(() => false)
revisar('el botón de armar deja uno de compartir', armo, armo ? await compartir.innerText() : '')

const bajada = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
  compartir.click(),
]).then(([d]) => d)
revisar(
  'y compartir entrega el archivo',
  bajada !== null && /\.tour$/.test(bajada.suggestedFilename()),
  bajada ? bajada.suggestedFilename() : 'no hubo descarga',
)

/* ── Y el aviso de lo que se quedó fuera ─────────────────────────────────
 * El archivo se arma aunque a una habitación le falte su foto, porque el
 * respaldo importa justo cuando el navegador ya borró cosas. Pero hay que
 * DECIRLO, o el agente cree que tiene una copia completa. */
await page.evaluate(async (id) => {
  const tours = await import('/src/lib/store/tours.ts')
  const tour = await tours.getTour(id)
  await tours.deleteImage(tour.scenes[0].imageId)
}, v2Guardado.id)

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.getByRole('button', { name: 'Preparar archivo' }).click()
await page.waitForTimeout(4000)
const avisoFaltante = await page
  .getByText(/No se pudo incluir|No se pudieron incluir/)
  .first()
  .innerText()
  .catch(() => null)
revisar(
  'y dice qué habitación se quedó fuera',
  avisoFaltante !== null && /Sala/.test(avisoFaltante),
  String(avisoFaltante),
)

/* Y el editor de puntos de esa habitación sin foto tiene que DECIRLO, no
   quedarse en "Abriendo la habitación…" para siempre: así estaba, porque el
   canvas solo se monta con URL y sin blob no había URL ni mensaje. */
await page.goto(`${BASE}#/puntos/${v2Guardado.id}/sala`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const sinFoto = await page.getByText(/ya no tiene foto/).isVisible().catch(() => false)
const cambiarFoto = await page.getByRole('button', { name: 'Cambiar la foto' }).isVisible().catch(() => false)
revisar('sin foto, el editor lo dice y ofrece cambiarla', sinFoto && cambiarFoto, `aviso ${sinFoto} · botón ${cambiarFoto}`)

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
 * UNA FOTO CON NORTE EN SUS METADATOS ENTRA CON BRÚJULA
 *
 * La app escribe GPano:PoseHeadingDegrees al exportar (xmp.ts), igual que las
 * cámaras 360 con brújula. Al subir esa foto, el rumbo tiene que llegar a la
 * escena: antes se leía el resto del GPano y el norte se tiraba, así que una
 * foto exportada por esta app volvía sin brújula. El escritor ya está probado
 * contra un modelo físico aparte (xmp.test.ts); aquí se prueba el cableado.
 * ========================================================================== */
console.log('\n=== Una foto con norte en sus metadatos entra con brújula ===')
const conNorte = await page.evaluate(async () => {
  const { conGPano } = await import('/src/lib/capture/xmp.ts')
  const blob = await (await fetch('/panoramas/cocina.jpg')).blob()
  const bitmap = await createImageBitmap(blob)
  const out = await conGPano(blob, { ancho: bitmap.width, alto: bitmap.height, norte: 123.5 })
  bitmap.close()
  const bytes = new Uint8Array(await out.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return { b64: btoa(s), crecio: out.size > blob.size }
})
revisar('el escritor metió el paquete GPano', conNorte.crecio)
await page.goto(`${BASE}#/editar/${v2Guardado.id}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.getByRole('button', { name: 'Agregar habitación' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Usar una foto que ya tengo' }).click()
await page.waitForTimeout(400)
await page
  .locator('input[type=file]')
  .first()
  .setInputFiles({ name: 'con-norte.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(conNorte.b64, 'base64') })
await page.waitForTimeout(3000)
await page.getByRole('textbox', { name: 'Nombre de la habitación' }).fill('Con norte')
await page.getByRole('button', { name: 'Guardar habitación' }).click()
await page.waitForTimeout(3500)
const escenaConNorte = await page.evaluate(async (id) => {
  const tours = await import('/src/lib/store/tours.ts')
  const t = await tours.getTour(id)
  return t?.scenes.find((e) => e.name === 'Con norte') ?? null
}, v2Guardado.id)
revisar(
  'la habitación entra con su rumbo',
  escenaConNorte !== null &&
    typeof escenaConNorte.rumbo === 'number' &&
    Math.abs(escenaConNorte.rumbo - 123.5) < 0.01,
  `rumbo ${escenaConNorte?.rumbo}`,
)

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

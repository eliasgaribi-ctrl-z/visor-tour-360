/**
 * ============================================================================
 *  PATRONES QUE NO DEBEN VOLVER
 * ============================================================================
 *
 *   node tools/pruebas/patrones.mjs
 *
 * Hay defectos que no son de comportamiento sino de FORMA: una manera de
 * escribir algo que ya se demostró equivocada y que, si vuelve a colarse en un
 * archivo distinto, reproduce el mismo bug. Una prueba de navegador no los
 * atrapa, porque solo mira la pantalla donde se acordó de mirar.
 *
 * De hecho este archivo existe por un caso real: se arregló el cálculo del FOV
 * de "Reencuadrar" en TourViewer, se le escribió su prueba de regresión… y el
 * MISMO patrón seguía vivo en el botón "Centrar" del editor de puntos, a
 * trescientas líneas. La prueba del visor pasaba en verde. Lo que faltaba no era
 * otra prueba de pantalla: era buscar al otro llamador.
 *
 * Corre sin navegador, así que va en el job rápido del CI.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = 'src'

/**
 * Cada patrón dice qué se busca, por qué está mal y cuál es la alternativa.
 * El texto de `porque` sale impreso cuando salta, así que se escribe para quien
 * lo va a leer con prisa y sin contexto.
 */
const PATRONES = [
  {
    nombre: 'FOV absoluto pedido como delta',
    /* La forma exacta del bug es RESTAR `readout.fov` de un objetivo:
         dFov += BASE_FOV - engine.readout.fov
       El guion tiene que ir pegado a `readout.fov`. Eso deja fuera, a propósito,
       el pellizco de useDragLook:
         dFov += (1 - ratio) * engine.readout.fov
       que usa el FOV actual como FACTOR DE ESCALA de un gesto continuo, no como
       resta contra un destino. Ahí es correcto: cada evento se autocorrige en el
       siguiente y no deja un valor final equivocado. */
    busca: /\bdFov\s*\+=[^\n]*-\s*(engine\.)?readout\.fov/,
    porque:
      'Pedir un FOV de destino como `dFov += OBJETIVO - readout.fov` está mal: `readout.fov`\n' +
      '     es el FOV SUAVIZADO y va por detrás del objetivo del rig, así que con el zoom en\n' +
      '     movimiento el delta sale mal y dos toques seguidos se pasan hasta `maxFov`.',
    enVezDe: '`engine.input.gotoFov = OBJETIVO` (destino absoluto, un solo disparo).',
  },
]

/**
 * El otro tipo de regla: no "esto no debe existir" sino **"esto solo puede
 * existir aquí, y estas veces"**.
 *
 * Sirve para los defectos de CLASE que no son un patrón malo, sino un patrón
 * bueno del que hay más copias de las que uno recuerda. El caso real que la
 * trajo: escribir un recorrido en IndexedDB. Al agregarle la estampa de versión
 * al modelo, la puse en `saveTour` con un comentario que decía "este es el único
 * camino de escritura"… y había TRES (`guardarEscenaConFoto` y `reemplazarFoto`
 * usan `idbPut` directo, porque escriben el recorrido y sus fotos en la misma
 * transacción). O sea que todo recorrido hecho con la cámara se habría quedado
 * sin estampa, en silencio, hasta la migración a la v3.
 *
 * Las cuentas son a propósito exactas y no un tope holgado: si alguien agrega un
 * cuarto escritor, esta prueba se pone roja y le hace mirar la lista completa —
 * que es justo lo que yo no hice.
 */
const EXCLUSIVOS = [
  {
    nombre: 'escribir un recorrido en IndexedDB',
    busca: /idbPut\([^)]*STORE_TOURS/,
    /* Cada archivo con la cuenta que le toca hoy. `tours.ts` tiene tres, uno por
       cada función que guarda, y las tres pasan por `paraGuardar()`. `paquete.ts`
       tiene uno, el del importador, que estampa a mano porque construye el
       registro entero desde el manifiesto. */
    permitido: { 'src/lib/store/tours.ts': 3, 'src/lib/store/paquete.ts': 1 },
    porque:
      'Un escritor nuevo del almacén de recorridos es un registro que puede quedarse SIN la\n' +
      '     estampa `formato`, y eso no se nota: el problema aparece cuando llegue la v3 y\n' +
      '     `normalizarTour` no sepa qué forma tiene lo que hay en el teléfono.',
    enVezDe: 'pasar el recorrido por `paraGuardar()` de src/lib/store/tours.ts antes de escribirlo.',
  },
]

/** Los archivos de código del proyecto, sin node_modules ni el build. */
function* archivos(dir) {
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) {
      yield* archivos(ruta)
    } else if (/\.(ts|tsx)$/.test(entrada)) {
      yield ruta
    }
  }
}

const golpes = []
/** Cuántas veces apareció cada regla exclusiva, por archivo. */
const cuentas = new Map(EXCLUSIVOS.map((e) => [e, new Map()]))

for (const ruta of archivos(RAIZ)) {
  const lineas = readFileSync(ruta, 'utf8').split('\n')
  lineas.forEach((linea, i) => {
    for (const p of PATRONES) {
      if (p.busca.test(linea)) golpes.push({ p, ruta, numero: i + 1, linea: linea.trim() })
    }
    for (const e of EXCLUSIVOS) {
      if (!e.busca.test(linea)) continue
      const porArchivo = cuentas.get(e)
      porArchivo.set(ruta, (porArchivo.get(ruta) ?? 0) + 1)
      // La línea se guarda por si hay que señalarla en el informe.
      golpes.push({ p: e, ruta, numero: i + 1, linea: linea.trim(), exclusivo: true })
    }
  })
}

/* Un golpe de regla exclusiva solo cuenta como fallo si el archivo no está en la
   lista o si aparece más veces de las declaradas. Lo demás es el estado normal. */
const sobran = []
for (const e of EXCLUSIVOS) {
  const porArchivo = cuentas.get(e)
  const rutas = new Set([...porArchivo.keys(), ...Object.keys(e.permitido)])
  for (const ruta of rutas) {
    const hay = porArchivo.get(ruta) ?? 0
    const debe = e.permitido[ruta] ?? 0
    if (hay !== debe) sobran.push({ e, ruta, hay, debe })
  }
}

const malos = golpes.filter((g) => !g.exclusivo)

console.log('=== Patrones que no deben volver ===')
for (const p of PATRONES) {
  const cuantos = malos.filter((g) => g.p === p).length
  console.log(`  ${p.nombre.padEnd(34)} ${cuantos === 0 ? 'limpio' : `${cuantos} APARICIONES`}`)
}

console.log('\n=== Y lo que solo puede estar donde debe ===')
for (const e of EXCLUSIVOS) {
  const total = [...cuentas.get(e).values()].reduce((a, b) => a + b, 0)
  const esperado = Object.values(e.permitido).reduce((a, b) => a + b, 0)
  const mal = sobran.filter((x) => x.e === e)
  console.log(
    `  ${e.nombre.padEnd(34)} ${mal.length === 0 ? 'en su sitio' : 'FUERA DE SITIO'}  ${total} de ${esperado}`,
  )
}

for (const x of sobran) {
  console.log(`\n${x.ruta}: ${x.hay} apariciones de "${x.e.nombre}", declaradas ${x.debe}`)
  console.log(`  ·  ${x.e.porque}`)
  console.log(`  ·  En vez de eso: ${x.e.enVezDe}`)
  console.log('  ·  Si el escritor nuevo es legítimo, actualiza la cuenta en `permitido`')
  console.log('     DESPUÉS de comprobar que pasa por el sello, no antes.')
}

if (malos.length === 0 && sobran.length === 0) {
  console.log('\nNINGUNO VOLVIÓ')
  process.exit(0)
}

for (const g of malos) {
  console.log(`\n${g.ruta}:${g.numero}`)
  console.log(`     ${g.linea}`)
  console.log(`  ·  ${g.p.porque}`)
  console.log(`  ·  En vez de eso: ${g.p.enVezDe}`)
}
process.exit(1)

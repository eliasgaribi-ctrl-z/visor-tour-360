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
for (const ruta of archivos(RAIZ)) {
  const lineas = readFileSync(ruta, 'utf8').split('\n')
  lineas.forEach((linea, i) => {
    for (const p of PATRONES) {
      if (p.busca.test(linea)) golpes.push({ p, ruta, numero: i + 1, linea: linea.trim() })
    }
  })
}

console.log('=== Patrones que no deben volver ===')
for (const p of PATRONES) {
  const cuantos = golpes.filter((g) => g.p === p).length
  console.log(`  ${p.nombre.padEnd(34)} ${cuantos === 0 ? 'limpio' : `${cuantos} APARICIONES`}`)
}

if (golpes.length === 0) {
  console.log('\nNINGUNO VOLVIÓ')
  process.exit(0)
}

for (const g of golpes) {
  console.log(`\n${g.ruta}:${g.numero}`)
  console.log(`     ${g.linea}`)
  console.log(`  ·  ${g.p.porque}`)
  console.log(`  ·  En vez de eso: ${g.p.enVezDe}`)
}
process.exit(1)

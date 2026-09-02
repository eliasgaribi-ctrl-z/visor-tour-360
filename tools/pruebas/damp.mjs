/**
 * ============================================================================
 *  ¿`damp` sigue siendo exactamente el de three.js?
 * ============================================================================
 *
 *   node tools/pruebas/damp.mjs
 *
 * `damp` es la interpolación exponencial que suaviza TODO el movimiento del
 * visor: el yaw, el pitch y el zoom pasan por ella en cada cuadro
 * (`src/components/tour/CameraRig.tsx`). Vive en `src/lib/math.ts`, y está
 * escrita a mano en vez de llamar a `THREE.MathUtils.damp`, para que ese módulo
 * no tenga que importar three.js por una sola función de tres líneas — la razón
 * completa está en el encabezado de `math.ts`.
 *
 * Copiar una fórmula es baratísimo y equivocarse es carísimo: una diferencia
 * sutil aquí no se ve como un error, se siente como que "el visor responde
 * raro", y nadie sabría por qué. Así que no se confía en que la copia esté
 * bien: se compara contra la de three, caso por caso, y se exige que sea
 * IDÉNTICA BIT A BIT. No "parecida": idéntica.
 *
 * ── EL ERROR QUE ESTA PRUEBA COMETIÓ, Y QUE NO SE DEBE REPETIR ────────────
 *
 * La primera versión de este arnés **transcribía `damp` a mano aquí dentro** y
 * comparaba ESA transcripción contra three. `src/lib/math.ts` no se leía nunca.
 * O sea que comparaba el oráculo contra una segunda copia del oráculo, y el paso
 * del CI llamado "La copia de `damp` sigue siendo exacta" pasaba en verde con la
 * fórmula de producción reemplazada por un lerp lineal —justo el defecto que este
 * encabezado llama carísimo—. Se demostró: 401/401 "idénticos", exit 0, con la
 * suavidad de toda la cámara rota.
 *
 * Y lo que tapó el hueco fue la justificación que estaba escrita al lado: "no se
 * importa, para que la prueba siga siendo una comprobación independiente". Tener
 * un oráculo independiente está bien, y `THREE.MathUtils.damp` **es** ese
 * oráculo. Lo que no vale nada es comparar el oráculo contra una copia suya.
 *
 * Ahora se importa la función REAL. Node 22 la carga sin compilar nada con
 * `--experimental-strip-types`: el `import type` de math.ts se despoja al vuelo y
 * no arrastra three, así que esto sigue corriendo en milisegundos y sin navegador.
 *
 * REGLA GENERAL, que este archivo aprendió a la mala: un arnés que reimplementa
 * lo que prueba no prueba nada. Si hay que copiar algo para probarlo, lo que hay
 * que arreglar es cómo importarlo.
 */
import * as THREE from 'three'

import { damp } from '../../src/lib/math.ts'

const casos = []

/* El rango que el visor usa de verdad: lambda 10 para el FOV, el `smoothing`
   del rig para yaw/pitch, y dt de 240 a 30 fps más el tope de 1/10 s que pone
   CameraRig cuando la pestaña vuelve del segundo plano. */
for (const lambda of [0, 1, 6, 10, 12, 25, 1e3]) {
  for (const dt of [0, 1 / 240, 1 / 120, 1 / 60, 1 / 30, 0.1, 1, 10]) {
    for (const [c, t] of [
      [0, 0],
      [0, 75], // reencuadrar desde el zoom máximo
      [75, 30], // acercarse
      [-180, 180], // el yaw no se normaliza: puede ir a cualquier lado
      [359.9, 0.1],
      [-1e6, 1e6], // yaw acumulado tras mucho girar
      [1e-12, 1e-12], // subnormales
    ]) {
      casos.push([c, t, lambda, dt])
    }
  }
}

/* Y los bordes que rompen una implementación descuidada. Importa que también
   coincidan: si three devuelve NaN y la copia devuelve 0, la cámara se
   comportaría distinto justo en el caso raro que nadie prueba a mano. */
casos.push(
  [NaN, 75, 10, 1 / 60],
  [0, NaN, 10, 1 / 60],
  [0, 75, NaN, 1 / 60],
  [0, 75, 10, NaN],
  [Infinity, 75, 10, 1 / 60],
  [0, 75, Infinity, 1 / 60],
  [0, 75, 10, Infinity],
  [0, 75, -10, 1 / 60], // lambda negativo: divergiría en vez de converger
  [0, 75, 10, -1 / 60], // dt negativo
)

let iguales = 0
const distintos = []

for (const [c, t, l, dt] of casos) {
  const esperado = THREE.MathUtils.damp(c, t, l, dt)
  const obtenido = damp(c, t, l, dt)
  /* Object.is y no `===`, para que NaN cuente como igual a NaN y para no dar por
     bueno un -0 donde three devuelve +0. */
  if (Object.is(esperado, obtenido)) iguales++
  else distintos.push({ current: c, target: t, lambda: l, dt, three: esperado, copia: obtenido })
}

console.log('=== `damp` de src/lib/math.ts contra THREE.MathUtils.damp ===')
console.log(`  casos probados            ${casos.length}`)
console.log(`  idénticos bit a bit       ${iguales}`)

if (distintos.length === 0) {
  console.log('\nLA COPIA ES EXACTA')
  process.exit(0)
}

console.log(`  DISTINTOS                 ${distintos.length}`)
console.log('\nLos primeros que no coinciden:')
for (const d of distintos.slice(0, 12)) {
  console.log(
    `  damp(${d.current}, ${d.target}, ${d.lambda}, ${d.dt})` +
      `  three ${d.three}  ·  copia ${d.copia}`,
  )
}
console.log(
  '\nLa fórmula de src/lib/math.ts dejó de coincidir con la de three. Antes de\n' +
    '"arreglar" la prueba: la buena es la de three, porque es la que se usó para\n' +
    'calibrar la sensación de la cámara y los números del README.',
)
process.exit(1)

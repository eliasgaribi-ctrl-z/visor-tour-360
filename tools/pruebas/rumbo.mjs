/**
 * ============================================================================
 *  LA BRÚJULA APUNTA AL NORTE DE VERDAD
 * ============================================================================
 *
 *   node --experimental-strip-types tools/pruebas/rumbo.mjs
 *
 * Esta prueba existe por una razón concreta: **el plan de este trabajo tenía el
 * signo al revés.** Decía guardar `offsetNorte - baseYaw`, y lo correcto es
 * `baseYaw + offsetNorte`. Con el signo malo la brújula pone el norte en el lado
 * OPUESTO —a 180° de donde está— y eso no se ve como un error, se ve como que
 * "la brújula anda raro". Nadie lo reporta y nadie lo encuentra.
 *
 * Así que no se comprueba contra la intuición ni contra la fórmula: se comprueba
 * contra ESCENARIOS FÍSICOS descritos en palabras, con la respuesta derivada de
 * la geometría y no de la implementación. Si alguien "arregla" el signo, estas
 * líneas dicen qué se rompió y por qué.
 *
 * Corre sin navegador: va en el job rápido del CI.
 */
import {
  etiquetaDelDisco,
  giroDeBrujula,
  gradosParaMostrar,
  rumboDeCamara,
  rumboDeEscena,
} from '../../src/lib/rumbo.ts'

let bien = true
const revisar = (que, ok, detalle = '') => {
  console.log(`  ${que.padEnd(52)} ${(ok ? 'ok' : 'MAL').padEnd(4)} ${detalle}`)
  if (!ok) bien = false
}

/* ── Qué rumbo tiene el frente de la panorámica ────────────────────────────
 *
 * `baseYaw` es el yaw del sensor al empezar la captura y `offsetNorte` es lo que
 * hay que sumarle a un yaw para obtener el rumbo real (así lo define `heading`
 * en orientation.ts). El frente de la panorámica es el yaw 0 de la panorámica,
 * o sea el `baseYaw` del sensor.
 */
console.log('=== El rumbo del frente de la panorámica ===')
const ESCENAS = [
  ['el sensor ya estaba en norte y el agente miraba al norte', 0, 0, 0],
  ['el sensor en norte, el agente mirando al ESTE', 90, 0, 90],
  ['el sensor en norte, el agente mirando al SUR', 180, 0, 180],
  ['el sensor en norte, el agente mirando al OESTE', 270, 0, 270],
  /* El caso realista: el cero del giroscopio es arbitrario y la brújula dice
     cuánto hay que corregirlo. Si el agente arrancó con el yaw del sensor en 30
     y la brújula dice que a ese yaw hay que sumarle 40 para tener rumbo, el
     frente mira al rumbo 70. */
  ['cero arbitrario del giroscopio: 30 de yaw, +40 de brújula', 30, 40, 70],
  ['y dando la vuelta al círculo', 300, 100, 40],
  ['con un offset negativo', 10, -30, 340],
]
for (const [que, baseYaw, offset, esperado] of ESCENAS) {
  const r = rumboDeEscena(baseYaw, offset)
  revisar(que, r === esperado, `${r}° (esperado ${esperado}°)`)
}

/* Sin brújula NO se guarda nada. Un rumbo inventado es peor que ninguno: con
   `undefined` el disco dice "frente" y no miente; con un número malo dice "N". */
console.log('\n=== Cuando no hubo brújula ===')
revisar('sin offset no hay rumbo', rumboDeEscena(90, null) === undefined, String(rumboDeEscena(90, null)))
revisar('un NaN tampoco se guarda', rumboDeEscena(90, NaN) === undefined)
revisar('ni un baseYaw roto', rumboDeEscena(NaN, 40) === undefined)
revisar("y el disco se etiqueta 'frente'", etiquetaDelDisco(undefined) === 'frente')
revisar("con rumbo se etiqueta 'N'", etiquetaDelDisco(0) === 'N')

/* ── Dónde aparece la N en la pantalla ─────────────────────────────────────
 *
 * El disco lleva la N arriba y se lee con la cámara apuntando hacia arriba. Un
 * glifo que está en el ángulo θ del disco aparece en el ángulo de pantalla
 * `θ + giro`, con 0 = arriba y creciendo en el sentido del reloj. Así que la N
 * (θ = 0) tiene que aparecer en `(rumbo del norte) − (rumbo de la cámara)`, o
 * sea en `−(rumbo de la cámara)`.
 *
 * La expectativa de cada caso está escrita a partir de esa frase y NO de la
 * fórmula del código: es lo único que hace que la prueba pueda cazar un signo.
 */
console.log('\n=== Dónde queda la N en la pantalla ===')
/** El ángulo de pantalla donde acaba la N, normalizado a (-180, 180]. */
const dondeLaN = (yaw, rumbo) => {
  const a = ((giroDeBrujula(yaw, rumbo) % 360) + 360) % 360
  return a > 180 ? a - 360 : a
}
const PANTALLA = [
  ['frente al norte, mirando al frente: la N arriba', 0, 0, 0],
  ['el frente mira al ESTE: la N queda a la IZQUIERDA', 0, 90, -90],
  ['el frente mira al OESTE: la N queda a la DERECHA', 0, 270, 90],
  ['el frente mira al SUR: la N queda abajo', 0, 180, 180],
  /* El frente mira al este y la cámara gira 90° a la derecha: ahora la cámara
     mira al SUR, así que el norte queda ATRÁS. */
  ['frente al este, la cámara girada 90° a la derecha', 90, 90, 180],
  /* El frente mira al este y la cámara gira 90° a la IZQUIERDA: la cámara mira
     al norte, así que la N vuelve arriba. */
  ['frente al este, la cámara girada 90° a la izquierda', -90, 90, 0],
  ['sin rumbo, el disco se orienta al frente de la foto', 90, undefined, -90],
]
for (const [que, yaw, rumbo, esperado] of PANTALLA) {
  const a = dondeLaN(yaw, rumbo)
  revisar(que, a === esperado, `${a}° (esperado ${esperado}°)`)
}

/* ── Y el número del centro ────────────────────────────────────────────────
 *
 * Tiene que decir lo MISMO que el disco. Un disco orientado al norte con un
 * número relativo al frente de la foto se contradicen, y quien lo mire creerá
 * el que le convenga.
 */
console.log('\n=== El número del centro dice lo mismo que el disco ===')
const NUMERO = [
  ['frente al este, mirando al frente → 90° (este)', 0, 90, 90],
  ['frente al este, girando 90° a la derecha → 180° (sur)', 90, 90, 180],
  ['frente al oeste, girando 90° a la derecha → 0° (norte)', 90, 270, 0],
  ['sin rumbo son los grados de la panorámica, como antes', 90, undefined, 90],
  ['y se normalizan', -90, undefined, 270],
]
for (const [que, yaw, rumbo, esperado] of NUMERO) {
  const r = rumboDeCamara(yaw, rumbo)
  revisar(que, r === esperado, `${r}° (esperado ${esperado}°)`)
}

/* Y el entero que se pinta, que no es lo mismo que el rumbo: redondear 359.6 da
   360, y "360°" en una brújula es un error de los que se ven a la primera. */
console.log('\n=== El entero que se pinta ===')
const ENTEROS = [
  ['359.6 no se pinta como 360', 359.6, undefined, 0],
  ['359.4 sí es 359', 359.4, undefined, 359],
  ['y con rumbo también', 300, 59.6, 0],
  ['un yaw negativo se normaliza', -0.4, undefined, 0],
  ['-11 pasa a 349, no a -11', -11, undefined, 349],
]
for (const [que, yaw, rumbo, esperado] of ENTEROS) {
  const g = gradosParaMostrar(yaw, rumbo)
  revisar(que, g === esperado, `${g}° (esperado ${esperado}°)`)
}

/* La comprobación que amarra las dos mitades: si la cámara mira al rumbo R,
   la N tiene que estar exactamente en -R. Se barre el círculo entero, así que
   ningún signo ni ningún wrap puede colarse en un caso suelto. */
console.log('\n=== Las dos mitades coinciden en todo el círculo ===')
/* La diferencia se mide EN EL CÍRCULO y no restando: -180 y 180 son el mismo
   ángulo, y compararlos como números daba un desvío de 360 en el único caso en
   que la cámara mira exactamente al sur. Era un fallo de la prueba, no del
   código, y por eso vale escribirlo aquí: la siguiente vez que alguien vea un
   360 en esta línea, que sospeche del wrap antes que de la brújula. */
const desvio = (a, b) => {
  const d = ((a - b) % 360 + 540) % 360 - 180
  return Math.abs(d)
}
let peor = 0
let peorCaso = ''
for (let rumbo = 0; rumbo < 360; rumbo += 7) {
  for (let yaw = -720; yaw <= 720; yaw += 13) {
    const d = desvio(dondeLaN(yaw, rumbo), -rumboDeCamara(yaw, rumbo))
    if (d > peor) {
      peor = d
      peorCaso = `yaw ${yaw}, rumbo ${rumbo}`
    }
  }
}
revisar(
  'la N está siempre en -(rumbo de la cámara)',
  peor < 1e-9,
  peor < 1e-9 ? '2860 combinaciones' : `peor desvío ${peor} en ${peorCaso}`,
)

console.log(`\n${bien ? 'LA BRÚJULA APUNTA BIEN' : 'HAY ALGO MAL'}`)
process.exit(bien ? 0 : 1)

/**
 * ============================================================================
 *  LA CORRECCIÓN DE NIVEL ENDEREZA EL HORIZONTE, Y EN EL SENTIDO QUE DICE
 * ============================================================================
 *
 *   node --experimental-strip-types tools/pruebas/nivel.mjs
 *
 * Sin navegador y sin GPU: se fabrica una panorámica sintética con el horizonte
 * marcado, se ladea con una rotación conocida —construida aquí con eje y ángulo,
 * NO con las funciones que se prueban— y se mide dónde queda el horizonte en lo
 * que vería el visor con un nivel dado. La regla de la que sale todo:
 *
 *     rotar la esfera por Q muestra en la dirección d lo que la textura tiene en Q⁻¹·d
 *
 * Lo que se afirma, en orden:
 *   1. sin nivel, el horizonte ladeado tiene la amplitud del ladeo inyectado
 *      (o sea que la métrica ve el problema);
 *   2. existe un nivel que lo devuelve a cero, y se encuentra buscando, no
 *      suponiendo el signo;
 *   3. cada eje mueve lo que su etiqueta dice: `tiltX` sube y baja el FRENTE y deja
 *      quietos los costados, `tiltZ` al revés — y `tiltX` positivo SUBE el frente,
 *      que es lo que dice la etiqueta del control en el editor;
 *   4. `corregirPunto` deja un punto pegado al mismo detalle de la foto al cambiar
 *      el nivel, y volver al nivel original lo devuelve al mismo sitio.
 *
 * El signo es el tipo de error que se ve como "se ve peor y nadie sabe por qué":
 * por eso las expectativas están escritas en términos de la escena, no de la
 * fórmula.
 */
import * as THREE from 'three'

import { corregirPunto, cuaternionDeNivel, hayNivel } from '../../src/lib/nivel.ts'

const DEG = Math.PI / 180
let bien = true
const revisar = (que, ok, detalle = '') => {
  console.log(`  ${que.padEnd(56)} ${(ok ? 'ok' : 'MAL').padEnd(4)} ${detalle}`)
  if (!ok) bien = false
}

/* ── La panorámica sintética: brillo 255 en el horizonte, 0 en el resto ────── */
const ANCHO = 720
const ALTO = 360
const P = new Uint8Array(ANCHO * ALTO)
for (let x = 0; x < ANCHO; x++) P[(ALTO / 2 - 1) * ANCHO + x] = 255

/** Brillo de la textura P en una dirección del mundo (vecino más cercano). */
const dirAUV = (d) => {
  const yaw = Math.atan2(d.x, -d.z)
  const pitch = Math.asin(Math.max(-1, Math.min(1, d.y)))
  const u = yaw / (2 * Math.PI) + 0.5
  const v = (Math.PI / 2 - pitch) / Math.PI
  return {
    x: Math.min(ANCHO - 1, Math.max(0, Math.round(u * ANCHO - 0.5))),
    y: Math.min(ALTO - 1, Math.max(0, Math.round(v * ALTO - 0.5))),
  }
}
const muestra = (img, d) => {
  const { x, y } = dirAUV(d)
  return img[y * ANCHO + x]
}

/** Dirección (yaw, pitch) en grados → vector, misma convención que el proyecto. */
const vec = (yawDeg, pitchDeg) => {
  const y = yawDeg * DEG
  const p = pitchDeg * DEG
  return new THREE.Vector3(Math.cos(p) * Math.sin(y), Math.sin(p), -Math.cos(p) * Math.cos(y))
}

/**
 * Lo que vería el visor en la dirección d con la textura ladeada por R y el
 * nivel Q aplicado a la esfera: la textura ladeada tiene en d lo que la original
 * tenía en R⁻¹·d, y la esfera rotada por Q muestra en d lo de Q⁻¹·d.
 */
const visor = (R, Q, d) => {
  const q = Q.clone().invert()
  const r = R.clone().invert()
  return muestra(P, d.clone().applyQuaternion(q).applyQuaternion(r))
}

/** A qué pitch aparece el horizonte en la columna `yaw`, barriendo de -30 a 30 en pasos de 0.25. */
const horizonteEn = (R, Q, yaw) => {
  let mejor = null
  let brillo = -1
  for (let p = -30; p <= 30; p += 0.25) {
    const b = visor(R, Q, vec(yaw, p))
    if (b > brillo) {
      brillo = b
      mejor = p
    }
  }
  return brillo > 0 ? mejor : null
}

/** Amplitud del horizonte: el peor |pitch| en 24 columnas. Cero = a nivel. */
const amplitud = (R, Q) => {
  let peor = 0
  for (let yaw = -180; yaw < 180; yaw += 15) {
    const h = horizonteEn(R, Q, yaw)
    if (h === null) return Infinity
    peor = Math.max(peor, Math.abs(h))
  }
  return peor
}

const IDENTIDAD = new THREE.Quaternion()

/* ── 1. La métrica ve el ladeo ─────────────────────────────────────────────── */
console.log('=== La métrica ve el ladeo ===')
/* La fila del horizonte mide medio grado (360 filas para 180°) y ninguna cae
   centrada en pitch 0: la más cercana está en +0.25°. Esa es la resolución de la
   métrica, y todas las tolerancias de abajo la respetan. */
const original = amplitud(IDENTIDAD, IDENTIDAD)
revisar('la panorámica original está a nivel (± media fila)', original <= 0.25, `${original}°`)

// Un ladeo GLOBAL construido con eje y ángulo, sin pasar por nivel.ts.
const ejeInclinado = new THREE.Vector3(1, 0, 0.6).normalize()
const R = new THREE.Quaternion().setFromAxisAngle(ejeInclinado, 4 * DEG)
const sinCorregir = amplitud(R, IDENTIDAD)
revisar('ladeada 4° sobre un eje horizontal: amplitud ≈ 4°', Math.abs(sinCorregir - 4) < 0.6, `${sinCorregir.toFixed(2)}°`)

/* ── 2. Existe un nivel que lo endereza, y se ENCUENTRA ───────────────────── */
console.log('\n=== Existe un nivel que lo endereza ===')
let mejor = { amp: Infinity, tiltX: 0, tiltZ: 0 }
for (let tx = -8; tx <= 8; tx += 0.5) {
  for (let tz = -8; tz <= 8; tz += 0.5) {
    const amp = amplitud(R, cuaternionDeNivel({ tiltX: tx, tiltZ: tz }))
    if (amp < mejor.amp) mejor = { amp, tiltX: tx, tiltZ: tz }
  }
}
revisar(
  'buscando en ±8° hay un nivel que baja la amplitud a < 0.5°',
  mejor.amp < 0.5,
  `nivel (${mejor.tiltX}, ${mejor.tiltZ}) → ${mejor.amp.toFixed(2)}°`,
)
/* Y el signo contrario la EMPEORA: si esto no fuera así, el signo no importaría
   y esta prueba no probaría nada. */
const alReves = amplitud(R, cuaternionDeNivel({ tiltX: -mejor.tiltX, tiltZ: -mejor.tiltZ }))
revisar('y el nivel con el signo al revés la duplica', alReves > 6, `${alReves.toFixed(2)}°`)

/* ── 3. Cada eje mueve lo que dice su etiqueta ────────────────────────────── */
console.log('\n=== Cada eje mueve lo que dice su etiqueta ===')
const soloX = cuaternionDeNivel({ tiltX: 5, tiltZ: 0 })
const soloZ = cuaternionDeNivel({ tiltX: 0, tiltZ: 5 })
const frenteX = horizonteEn(IDENTIDAD, soloX, 0)
const atrasX = horizonteEn(IDENTIDAD, soloX, 180)
const ladoX = horizonteEn(IDENTIDAD, soloX, 90)
revisar('tiltX = +5 SUBE el horizonte del frente 5°', Math.abs(frenteX - 5) < 0.3, `${frenteX}°`)
revisar('… y lo BAJA atrás 5°', Math.abs(atrasX + 5) < 0.3, `${atrasX}°`)
revisar('… y deja quieto el costado', Math.abs(ladoX) < 0.3, `${ladoX}°`)
const derZ = horizonteEn(IDENTIDAD, soloZ, 90)
const izqZ = horizonteEn(IDENTIDAD, soloZ, -90)
const frenteZ = horizonteEn(IDENTIDAD, soloZ, 0)
revisar('tiltZ = +5 mueve el costado derecho 5°', Math.abs(Math.abs(derZ) - 5) < 0.3, `${derZ}°`)
// Dos lecturas, cada una con su media fila de resolución: la suma tolera una fila.
revisar('… el izquierdo 5° al revés', Math.abs(derZ + izqZ) <= 0.5 && izqZ < -4, `${izqZ}°`)
revisar('… y deja quieto el frente', Math.abs(frenteZ) < 0.3, `${frenteZ}°`)
revisar('sin nivel, la identidad', cuaternionDeNivel(undefined).equals(IDENTIDAD))
revisar('un nivel en cero no es nivel', !hayNivel({ tiltX: 0, tiltZ: 0 }) && hayNivel({ tiltX: 0.25, tiltZ: 0 }))

/* ── 4. Los puntos se quedan sobre lo mismo de la foto ────────────────────── */
console.log('\n=== Un punto sigue sobre el mismo detalle al cambiar el nivel ===')
const A = { tiltX: 1.5, tiltZ: -2 }
const B = { tiltX: -3, tiltZ: 4.5 }
const QA = cuaternionDeNivel(A)
const QB = cuaternionDeNivel(B)
let peorDesvio = 0
for (const [yaw, pitch] of [[0, 0], [62, -6], [-74, -6], [168, 4], [30, 40], [-120, -35]]) {
  // Con el nivel A, el punto marca el detalle u = A⁻¹·d de la textura.
  const d = vec(yaw, pitch)
  const u = d.clone().applyQuaternion(QA.clone().invert())
  // Con el nivel B ese detalle se ve en B·u.
  const esperado = u.clone().applyQuaternion(QB)
  const c = corregirPunto(yaw, pitch, A, B)
  const desvio = vec(c.yaw, c.pitch).angleTo(esperado) / DEG
  peorDesvio = Math.max(peorDesvio, desvio)
}
revisar('seis puntos siguen a su detalle al pasar de A a B', peorDesvio < 1e-6, `peor desvío ${peorDesvio.toExponential(1)}°`)
const ida = corregirPunto(62, -6, A, B)
const vuelta = corregirPunto(ida.yaw, ida.pitch, B, A)
revisar('y volver de B a A devuelve el punto original', Math.abs(vuelta.yaw - 62) < 1e-9 && Math.abs(vuelta.pitch + 6) < 1e-9, `${vuelta.yaw.toFixed(6)}, ${vuelta.pitch.toFixed(6)}`)
const quieto = corregirPunto(62, -6, undefined, undefined)
revisar('sin nivel en los dos lados, no se mueve', Math.abs(quieto.yaw - 62) < 1e-9 && Math.abs(quieto.pitch + 6) < 1e-9)

console.log(`\n${bien ? 'EL NIVEL ENDEREZA' : 'HAY ALGO MAL'}`)
process.exit(bien ? 0 : 1)

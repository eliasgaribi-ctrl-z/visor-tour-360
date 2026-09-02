/* Con la extensión `.ts` puesta, y es a propósito: es el único import así en
   todo `src/`. Node carga los `.ts` reales con `--experimental-strip-types`,
   pero su resolutor de ESM no adivina extensiones, así que sin esto
   `tools/pruebas/rumbo.mjs` no podría importar este módulo — y tendría que
   copiar aquí las fórmulas para probarlas, que es exactamente lo que dejó a
   `damp.mjs` y `contraste.mjs` probando nada durante semanas. La lección de esa
   ronda fue: si hay que copiar algo para probarlo, lo que hay que arreglar es
   cómo importarlo. `allowImportingTsExtensions` ya estaba en el tsconfig y Vite
   lo resuelve igual. */
import { wrap360 } from './math.ts'

/**
 * ============================================================================
 *  EL NORTE DE VERDAD
 * ============================================================================
 *
 * ── El dato que se calculaba y se tiraba a la basura ──────────────────────
 *
 * `OrientationTracker` promedia doce lecturas de brújula, saca la mediana y
 * expone `offsetNorte`. Grepeando todo `src/`, las únicas apariciones de
 * `offsetNorte`, `.heading` y `.absolute` estaban DENTRO de `orientation.ts`:
 * nadie las leía nunca.
 *
 * Consecuencia: la brújula del visor mentía. Su "N" apuntaba al frente
 * arbitrario de la foto —donde el agente tenía el teléfono al empezar— y no al
 * norte. El dato para hacerlo bien ya se calculaba en cada captura y se
 * descartaba al terminar.
 *
 * ── Qué se guarda, y por qué se llama `rumbo` y no `norte` ────────────────
 *
 * Se guarda **el rumbo real al que mira el frente de la panorámica**: 0 = norte,
 * creciendo a la derecha, igual que `webkitCompassHeading`.
 *
 * El nombre importa más de lo que parece. El plan de este trabajo decía guardar
 * "el norte" con la fórmula `offsetNorte - baseYaw`, y **el signo estaba al
 * revés**: la brújula habría puesto el norte en el lado opuesto, que es
 * exactamente el tipo de error que "se ve raro" y nadie sabe explicar. Un campo
 * que se llama por lo que ES —el rumbo del frente— se puede verificar leyendo su
 * definición; uno que se llama por para qué SIRVE hay que derivarlo cada vez.
 *
 * La cadena completa, que es de dónde sale el signo:
 *
 *     yaw del sensor        s
 *     rumbo real            s + offsetNorte          (así lo define `heading`)
 *     yaw de la panorámica  p = s - baseYaw          (así lo usa el plan de captura)
 *   ⟹ rumbo de la panorámica p + baseYaw + offsetNorte
 *   ⟹ rumbo del frente (p=0) = baseYaw + offsetNorte
 */

/**
 * El rumbo al que mira el frente de una panorámica recién capturada.
 *
 * @param baseYaw      yaw del sensor cuando empezó la captura.
 * @param offsetNorte  lo que hay que sumarle a un yaw para tener rumbo real.
 *                     `null` cuando no hubo brújula: entonces no se guarda nada,
 *                     porque un rumbo inventado es peor que ninguno.
 */
export function rumboDeEscena(baseYaw: number, offsetNorte: number | null): number | undefined {
  if (offsetNorte === null || !Number.isFinite(offsetNorte) || !Number.isFinite(baseYaw)) {
    return undefined
  }
  return wrap360(baseYaw + offsetNorte)
}

/**
 * Cuánto hay que rotar el disco de la brújula, en grados.
 *
 * El disco lleva la "N" arriba y se lee con la dirección de la cámara apuntando
 * hacia arriba, así que la N tiene que aparecer en el ángulo de pantalla
 * `(rumbo del norte) − (rumbo de la cámara)` = `−(yaw + rumbo)`.
 *
 * Sin `rumbo` se devuelve `−yaw`, que es lo que la brújula hacía siempre: el
 * disco se orienta al frente de la foto. Ahí la etiqueta NO debe decir "N"
 * —ver `etiquetaDelDisco`—, porque eso sería mentir.
 */
export function giroDeBrujula(yaw: number, rumbo: number | undefined): number {
  return rumbo === undefined ? -yaw : -(yaw + rumbo)
}

/**
 * Qué dice el número del centro de la brújula.
 *
 * Con `rumbo` es el rumbo REAL al que mira la cámara; sin él, los mismos grados
 * de panorámica que se mostraban antes. No se pueden mezclar: un disco orientado
 * al norte con un número relativo al frente de la foto se contradicen, y quien
 * lo mire creerá el que le convenga.
 */
export function rumboDeCamara(yaw: number, rumbo: number | undefined): number {
  return rumbo === undefined ? wrap360(yaw) : wrap360(yaw + rumbo)
}

/**
 * El entero que se pinta en el centro del disco.
 *
 * Redondear y luego volver a envolver, en ese orden: un rumbo de 359.6 redondea
 * a 360, y "360°" en una brújula es un error de los que se ven a la primera y
 * nadie escribe una prueba para ellos. Aquí sale 0.
 *
 * Ojo con un cambio de comportamiento que trae esto: sin `rumbo`, el número era
 * el yaw crudo de la panorámica y podía salir negativo ("-11°"). Ahora se
 * normaliza al círculo ("349°"), que es la convención de cualquier brújula y lo
 * único coherente con el disco que tiene al lado.
 */
export function gradosParaMostrar(yaw: number, rumbo: number | undefined): number {
  return Math.round(rumboDeCamara(yaw, rumbo)) % 360
}

/**
 * Lo que va arriba del disco.
 *
 * "N" solo cuando de verdad es el norte. Una foto importada no trae rumbo —no
 * hubo sensor— y ahí el disco sigue sirviendo para saber cuánto se giró
 * respecto al frente, que es útil, pero llamarlo norte sería inventar. No
 * mentir es parte del valor de una brújula.
 */
export function etiquetaDelDisco(rumbo: number | undefined): 'N' | 'frente' {
  return rumbo === undefined ? 'frente' : 'N'
}

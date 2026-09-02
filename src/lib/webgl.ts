/**
 * ============================================================================
 *  ¿PUEDE ESTE NAVEGADOR ABRIR EL VISOR?
 * ============================================================================
 *
 * Una sola pregunta, contestada una sola vez, en un archivo que no exporta
 * ningún componente.
 *
 * Vivía dentro de `components/tour/ViewerGuard.tsx`, y de rebote se reexportaba
 * también desde `Escena360.tsx`. Eso tenía dos costos. El primero, de
 * herramienta: un módulo que mezcla componentes de React con funciones sueltas
 * rompe el refresco en caliente de Vite —al tocar la función se recarga la
 * página entera en vez de solo el componente— y es lo que oxlint marcaba con
 * `react/only-export-components`. El segundo, de peso: la pantalla de captura
 * solo necesita saber si hay WebGL, y al importarlo desde `Escena360` se traía
 * de paso el fragmento del visor completo (168 kB) a una pantalla que nunca lo
 * usa.
 *
 * Aquí no hay JSX, así que quien solo quiere la respuesta se lleva la respuesta.
 */

export type Deteccion = {
  ok: boolean
  /** Para poder dar un consejo distinto según qué falta. */
  causa?: 'sin-webgl2' | 'sin-contexto' | 'excepcion'
  motivo?: string
}

let deteccion: Deteccion | null = null

/**
 * ¿Este navegador puede darnos WebGL ahora mismo?
 *
 * El contexto de prueba se SUELTA en cuanto se responde, y la respuesta se
 * guarda: un celular aguanta pocos contextos WebGL vivos a la vez (ocho o
 * dieciséis), y esta función se llama en cada montaje del visor y del editor.
 * Dejar uno abandonado en cada llamada se lleva por delante justo el que la
 * escena necesita.
 */
export function detectWebGL(): Deteccion {
  if (deteccion) return deteccion
  try {
    const canvas = document.createElement('canvas')

    /* WebGL 2 y NADA MÁS. Antes esto aceptaba un contexto WebGL 1 como bueno,
       y era peor que no detectar nada: three.js r185 pide `webgl2` a secas
       —la rama de WebGL 1 se quitó en r163— así que el canvas se montaba y el
       motor reventaba adentro. Y ese error no lo atrapa la frontera: R3F crea
       el renderer en un `configure()` asíncrono al que nadie le pone `.catch`,
       o sea que es una promesa rechazada, no una excepción de render. React no
       la ve. El resultado medido en un iPhone con iOS 13 no era una pantalla
       negra: era el velo de "Cargando panorámica…" girando para siempre, que
       para diagnosticar es todavía peor. */
    const gl2 = canvas.getContext('webgl2')
    if (!gl2) {
      // Se pregunta por WebGL 1 solo para poder decir CUÁL de los dos falta.
      const gl1 = canvas.getContext('webgl')
      // Soltar también aquí: antes solo se soltaba en el camino del éxito, y
      // un iPhone aguanta pocos contextos vivos.
      gl1?.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.width = 0
      canvas.height = 0
      deteccion = gl1
        ? {
            ok: false,
            causa: 'sin-webgl2',
            motivo: 'este navegador solo tiene WebGL 1; el motor 3D necesita WebGL 2',
          }
        : {
            ok: false,
            causa: 'sin-contexto',
            motivo: 'el navegador no entregó un contexto WebGL',
          }
      return deteccion
    }
    gl2.getExtension('WEBGL_lose_context')?.loseContext()
    canvas.width = 0
    canvas.height = 0
    deteccion = { ok: true }
  } catch (e) {
    deteccion = {
      ok: false,
      causa: 'excepcion',
      motivo: e instanceof Error ? e.message : String(e),
    }
  }
  return deteccion
}

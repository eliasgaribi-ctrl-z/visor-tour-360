/* oxlint-disable react/refs -- El valor se lee dentro de useFrame, así que no
   puede vivir en useState: un re-render por cuadro es justo lo que se evita. */
import { useEffect, useRef } from 'react'

/**
 * ============================================================================
 *  ¿ESTE APARATO PIDIÓ MENOS MOVIMIENTO?
 * ============================================================================
 *
 * Devuelve un ref con la respuesta, listo para leer desde un `useFrame` sin
 * costo. Un ref y no `useState` a propósito: quien lo necesita lo consulta
 * dentro del bucle de dibujo, y un cambio de estado ahí re-renderizaría el árbol
 * en medio de una animación — justo lo que el visor entero está diseñado para
 * evitar (ver `src/lib/tourEngine.ts`).
 *
 * ── Por qué existe este archivo en vez de una línea suelta ─────────────────
 *
 * La forma obvia de responder la pregunta es llamar a
 * `matchMedia('(prefers-reduced-motion: reduce)').matches` donde se necesite. Y
 * está bien… salvo dentro de un `useFrame`, que es exactamente donde se
 * necesitaba: ahí son sesenta llamadas por segundo, cada una construyendo un
 * `MediaQueryList` nuevo, en el único lugar del proyecto donde la regla es NO
 * TRABAJAR POR CUADRO. Se hizo así primero y así se arregló.
 *
 * La respuesta se lee UNA vez al montar y se mantiene al día con un listener,
 * porque el ajuste se puede cambiar con la pestaña abierta (en iOS está en
 * Ajustes → Accesibilidad → Movimiento, y volver a Safari no recarga la página).
 *
 * ── El detalle de compatibilidad que importa ───────────────────────────────
 *
 * `MediaQueryList.addEventListener('change', …)` es lo moderno y correcto, pero
 * llegó a Safari en la 14. El piso del proyecto es Safari 13, y ahí `mq` existe
 * pero no tiene `addEventListener`: llamarlo tira un TypeError y se lleva por
 * delante el efecto entero. El `addListener` de siempre sigue existiendo (está
 * marcado como obsoleto, no removido), así que se usa como respaldo. Sin esa
 * escalera, en un iPhone con iOS 13 el visor no arranca — y el error sería un
 * `undefined is not a function` dentro de un efecto, que no dice nada.
 */
const CONSULTA = '(prefers-reduced-motion: reduce)'

export function useMenosMovimiento() {
  const menos = useRef(false)

  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia(CONSULTA)
    menos.current = mq.matches

    const alCambiar = () => {
      menos.current = mq.matches
    }

    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', alCambiar)
      return () => mq.removeEventListener('change', alCambiar)
    }
    // Safari 13: la API vieja, que sigue funcionando.
    mq.addListener(alCambiar)
    return () => mq.removeListener(alCambiar)
  }, [])

  return menos
}

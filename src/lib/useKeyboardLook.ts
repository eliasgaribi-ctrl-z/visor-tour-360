import { useEffect } from 'react'
import type { TourEngine } from './tourEngine'

const KEYS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  d: [1, 0],
  a: [-1, 0],
  w: [0, 1],
  s: [0, -1],
}

/**
 * Flechas / WASD para mirar alrededor en escritorio.
 * Escribe en el mismo eje que el joystick, así que la cámara ni se entera de
 * quién la está moviendo.
 */
export function useKeyboardLook(engine: TourEngine) {
  useEffect(() => {
    const pressed = new Set<string>()

    const apply = () => {
      let x = 0
      let y = 0
      for (const key of pressed) {
        const [kx, ky] = KEYS[key]
        x += kx
        y += ky
      }
      const magnitude = Math.hypot(x, y)
      engine.input.axis.x = magnitude > 1 ? x / magnitude : x
      engine.input.axis.y = magnitude > 1 ? y / magnitude : y
      engine.invalidar()
    }

    const normalize = (key: string) => (key.length === 1 ? key.toLowerCase() : key)

    /**
     * ¿La tecla es para la cámara, o alguien está escribiendo?
     *
     * Estos listeners viven en `window` y hacen `preventDefault()` sobre las
     * flechas y sobre a/s/w/d. Hoy el visor no monta ni un campo de texto, así
     * que no muerde — pero en cuanto lo haga (un formulario de contacto, una
     * nota en el panel de información, un buscador de habitaciones), escribir
     * "casa" giraría la cámara y la letra no aparecería en el campo. Es una
     * bomba de relojería de tres líneas de arreglo, y este es el arreglo.
     *
     * También sale de en medio cuando el foco está en algo con scroll propio o
     * en un `contenteditable`, y respeta el modo de composición de los teclados
     * de idiomas con IME (`isComposing`), donde las flechas eligen candidato.
     */
    const escribiendo = (event: KeyboardEvent) => {
      if (event.isComposing) return true
      const destino = event.target
      if (!(destino instanceof HTMLElement)) return false
      if (destino.isContentEditable) return true
      const etiqueta = destino.tagName
      return etiqueta === 'INPUT' || etiqueta === 'TEXTAREA' || etiqueta === 'SELECT'
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const key = normalize(event.key)
      if (!(key in KEYS)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (escribiendo(event)) return
      event.preventDefault()
      pressed.add(key)
      apply()
    }

    /* En `keyup` NO se comprueba nada: si el foco cambió a un campo mientras la
       tecla estaba apretada, hay que soltarla igual o la cámara se queda
       girando sola para siempre. Es el mismo motivo por el que existe `onBlur`
       más abajo. */
    const onKeyUp = (event: KeyboardEvent) => {
      const key = normalize(event.key)
      if (!(key in KEYS)) return
      pressed.delete(key)
      apply()
    }

    // Si la ventana pierde el foco con una tecla apretada, la cámara giraría
    // para siempre. Soltamos todo.
    const onBlur = () => {
      pressed.clear()
      apply()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [engine])
}

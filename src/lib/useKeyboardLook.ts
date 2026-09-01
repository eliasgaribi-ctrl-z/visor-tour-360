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
    }

    const normalize = (key: string) => (key.length === 1 ? key.toLowerCase() : key)

    const onKeyDown = (event: KeyboardEvent) => {
      const key = normalize(event.key)
      if (!(key in KEYS)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      pressed.add(key)
      apply()
    }

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

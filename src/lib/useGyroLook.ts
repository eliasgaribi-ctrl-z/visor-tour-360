/* oxlint-disable react/refs, react/immutability -- El seguidor y el último
   cuaternión aplicado viven en refs, y las lecturas se escriben en `engine.input`
   como hace todo el que mueve la cámara: los sensores disparan unas sesenta veces
   por segundo y ninguna lectura debe pasar por React. Ver la nota de arquitectura
   en tourEngine.ts. */
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { TourEngine } from './tourEngine'
import {
  OrientationTracker,
  angleBetween,
  anglesOf,
  needsOrientationPermission,
  requestOrientationPermission,
  type OrientationState,
} from './capture/orientation'
import { contextoSeguro } from './capture/camera'

/**
 * ============================================================================
 *  MIRAR ALREDEDOR MOVIENDO EL TELÉFONO
 * ============================================================================
 *
 * Se reutiliza entero el seguidor de la captura (`OrientationTracker`): la
 * conversión de sensores a (yaw, pitch), la corrección por la orientación de la
 * pantalla, el permiso de iOS y el suavizado adaptativo ya están escritos y
 * verificados en las nueve posturas (README, sección 12). Este hook solo lo
 * conecta al input del visor.
 *
 * ── El problema de verdad es `invalidar()`, y la respuesta es una ZONA MUERTA ─
 *
 * Los sensores disparan ~60 eventos por segundo y NUNCA paran, ni con el
 * teléfono en la mesa. Si cada lectura tocara el timbre, `despiertoHasta` se
 * renovaría para siempre y el visor dibujaría a 60 fps permanentemente: se
 * perdería exactamente la propiedad que el README documenta como medida (0
 * dibujos por segundo parado).
 *
 * La solución no es un throttle temporal —seguiría dibujando N veces por
 * segundo con el teléfono quieto— sino una zona muerta ANGULAR: una lectura que
 * no se aparta más de ZONA_MUERTA grados de la última aplicada no se aplica.
 * Con el teléfono quieto, el ruido del giroscopio integrado queda por debajo, y
 * el visor vuelve a cero cuadros; en la mano nunca baja de ahí, así que la
 * respuesta es inmediata. Y no se abre ningún requestAnimationFrame propio: la
 * lectura se consume dentro del propio evento. `giroscopio.mjs` mide las dos
 * mitades: quieto, cero dibujos; moviéndose, la cámara sigue al teléfono.
 *
 * ── Cómo convive con el joystick y el arrastre ─────────────────────────────
 *
 * Eso lo resuelve `CameraRig`, no este hook: el sensor es ABSOLUTO y manda sobre
 * el objetivo; el gesto ajusta un offset. Aquí solo se escribe
 * `input.orientacion` y se toca el timbre. El pitch va sin offset (lo manda solo
 * el sensor) y el roll no se usa: el rig no tiene roll, y un horizonte que se
 * ladea con la muñeca se lee como defecto, no como inmersión.
 *
 * Se lee `reading.suave`, no `reading.quaternion`: el suavizado adaptativo del
 * seguidor está escrito precisamente para interfaz (la cruda es para el disparo
 * de la captura, donde el retraso pegaría la foto en el lugar equivocado).
 */
export const ZONA_MUERTA = 0.15

export type Giroscopio = {
  /** Estado del seguidor, para pintar el botón. */
  estado: OrientationState
  /**
   * Si el botón debe existir: hace falta https (sin él el evento nunca llega y
   * la persona se queda tocando un control muerto) y que el navegador tenga el
   * evento. Que además HAYA sensores solo se sabe al intentarlo: ver
   * 'no-soportado' en `estado`.
   */
  disponible: boolean
  activar: () => Promise<void>
  desactivar: () => void
}

export function useGyroLook(engine: TourEngine): Giroscopio {
  const tracker = useRef<OrientationTracker | null>(null)
  const ultimo = useRef(new THREE.Quaternion())
  const hayUltimo = useRef(false)
  /* Un solo objeto que se reescribe: sesenta lecturas por segundo no deben
     asignar sesenta objetos por segundo. El rig lee los campos, no la identidad. */
  const destino = useRef({ yaw: 0, pitch: 0 })
  const [estado, setEstado] = useState<OrientationState>('inactivo')
  const [disponible] = useState(
    () => contextoSeguro() && typeof DeviceOrientationEvent !== 'undefined',
  )

  const desactivar = useCallback(() => {
    tracker.current?.stop()
    hayUltimo.current = false
    engine.input.orientacion = null
    engine.invalidar()
  }, [engine])

  const activar = useCallback(async () => {
    /* iOS 13+: el permiso tiene que salir de un gesto. Este `await` es el único
       del camino y viene justo después del toque, así que la activación sigue
       viva cuando Safari pregunta. */
    if (needsOrientationPermission()) {
      const respuesta = await requestOrientationPermission()
      if (respuesta === 'denied') {
        setEstado('denegado')
        return
      }
    }
    if (!tracker.current) {
      const t = new OrientationTracker()
      t.onStateChange = setEstado
      t.onReading = () => {
        const q = t.reading.suave
        if (hayUltimo.current && angleBetween(ultimo.current, q) < ZONA_MUERTA) return
        ultimo.current.copy(q)
        hayUltimo.current = true
        const { yaw, pitch } = anglesOf(q)
        destino.current.yaw = yaw
        destino.current.pitch = pitch
        engine.input.orientacion = destino.current
        engine.invalidar()
      }
      tracker.current = t
    }
    hayUltimo.current = false
    /* El joystick se esconde al encender el sensor. Si en ese instante alguien
       lo tenía empujado, su (0, 0) de soltar ya no llegaría y el eje se quedaría
       pegado, moviendo el offset para siempre. Se suelta aquí. */
    engine.input.axis.x = 0
    engine.input.axis.y = 0
    tracker.current.start()
  }, [engine])

  /* Con la pestaña oculta se apaga: un teléfono en el bolsillo no debe mover
     nada, y al volver la persona decide si lo quiere otra vez. Y al desmontar,
     siempre: un listener de sensores huérfano seguiría escribiendo en un engine
     que ya no existe. */
  useEffect(() => {
    const alCambiar = () => {
      if (document.visibilityState !== 'visible') desactivar()
    }
    document.addEventListener('visibilitychange', alCambiar)
    return () => {
      document.removeEventListener('visibilitychange', alCambiar)
      desactivar()
    }
  }, [desactivar])

  return { estado, disponible, activar, desactivar }
}

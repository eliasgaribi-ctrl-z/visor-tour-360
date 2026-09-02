import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export type JoystickProps = {
  /**
   * Se llama en cada movimiento con los ejes ya normalizados:
   *   x: -1 (izquierda) … +1 (derecha)
   *   y: -1 (abajo) … +1 (arriba)   ← ojo, Y positiva es ARRIBA
   * Al soltar siempre llega un (0, 0).
   */
  onChange: (x: number, y: number) => void
  /** Diámetro de la base visible, en px. */
  size?: number
  /** Diámetro del "botoncito" que se arrastra, en px. */
  knobSize?: number
  /**
   * 'floating' (default): la base aparece donde pones el pulgar dentro de la zona.
   * Es como funcionan los shooters móviles y perdona muchísimo la puntería.
   * 'fixed': la base siempre está en el mismo lugar.
   */
  mode?: 'floating' | 'fixed'
  /** Fracción del radio que se ignora para que no derive con el pulgar quieto. */
  deadZone?: number
  /**
   * Exponente de la curva de respuesta. 1 = lineal.
   * 2 (default) da control fino cerca del centro y velocidad completa en el borde.
   */
  curve?: number
  className?: string
  label?: string
}

/**
 * ============================================================================
 *  JOYSTICK VIRTUAL
 * ============================================================================
 *
 * Componente propio con Pointer Events en vez de una librería, por tres razones
 * concretas:
 *
 *   1. Pointer Events unifica dedo, mouse y lápiz en un solo camino de código,
 *      y `setPointerCapture` hace que el gesto siga funcionando aunque el dedo
 *      se salga del círculo — que es exactamente lo que pasa cuando alguien
 *      empuja fuerte para girar rápido.
 *   2. La posición del knob se escribe DIRECTO al DOM (`style.transform`), sin
 *      useState. Un pulgar genera ~120 eventos por segundo; pasarlos por React
 *      re-renderizaría el visor entero 120 veces por segundo.
 *   3. Se estiliza con Tailwind como cualquier otro div, así que vestirlo con
 *      la marca es cambiar clases y ya.
 *
 * La "zona del pulgar" es más grande que el círculo visible: puedes tocar en un
 * área cómoda de la esquina y el joystick se materializa ahí.
 */
export function Joystick({
  onChange,
  size = 124,
  knobSize = 54,
  mode = 'floating',
  deadZone = 0.08,
  curve = 2,
  className = '',
  label = 'Control de cámara',
}: JoystickProps) {
  const zoneRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)

  const activePointer = useRef<number | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const [active, setActive] = useState(false)

  /** Radio útil: el knob nunca se sale del borde de la base. */
  const radius = (size - knobSize) / 2

  const placeBase = useCallback(() => {
    const base = baseRef.current
    if (!base) return
    base.style.transform = `translate3d(${origin.current.x - size / 2}px, ${
      origin.current.y - size / 2
    }px, 0)`
  }, [size])

  /** Deja la base en su sitio de reposo (centro de la zona). */
  const resetOrigin = useCallback(() => {
    const zone = zoneRef.current
    if (!zone) return
    origin.current = { x: zone.clientWidth / 2, y: zone.clientHeight / 2 }
    placeBase()
  }, [placeBase])

  useEffect(() => {
    resetOrigin()
    const zone = zoneRef.current
    if (!zone || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (activePointer.current === null) resetOrigin()
    })
    observer.observe(zone)
    return () => observer.disconnect()
  }, [resetOrigin])

  const moveKnob = useCallback((offsetX: number, offsetY: number) => {
    const knob = knobRef.current
    if (!knob) return
    knob.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) translate(-50%, -50%)`
  }, [])

  const update = useCallback(
    (clientX: number, clientY: number) => {
      const zone = zoneRef.current
      if (!zone) return
      const rect = zone.getBoundingClientRect()

      const dx = clientX - (rect.left + origin.current.x)
      const dy = clientY - (rect.top + origin.current.y)

      const distance = Math.hypot(dx, dy)
      const clamped = Math.min(distance, radius)
      const ux = distance > 0 ? dx / distance : 0
      const uy = distance > 0 ? dy / distance : 0

      // Lo que se ve: el knob sigue al dedo hasta el borde.
      moveKnob(ux * clamped, uy * clamped)

      // Lo que se envía: magnitud sin zona muerta y con curva de respuesta.
      const magnitude = radius > 0 ? clamped / radius : 0
      const normalized =
        magnitude <= deadZone ? 0 : (magnitude - deadZone) / (1 - deadZone)
      const shaped = Math.pow(normalized, curve)

      // La pantalla tiene la Y hacia abajo; la cámara la quiere hacia arriba.
      onChange(ux * shaped, -uy * shaped)
    },
    [curve, deadZone, moveKnob, onChange, radius],
  )

  const release = useCallback(() => {
    activePointer.current = null
    setActive(false)
    moveKnob(0, 0)
    onChange(0, 0)
    resetOrigin()
  }, [moveKnob, onChange, resetOrigin])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== null) return
    const zone = zoneRef.current
    if (!zone) return

    activePointer.current = event.pointerId
    zone.setPointerCapture(event.pointerId)
    setActive(true)

    if (mode === 'floating') {
      const rect = zone.getBoundingClientRect()
      // La base aparece bajo el pulgar, sin salirse de la zona.
      const half = size / 2
      origin.current = {
        x: Math.min(Math.max(event.clientX - rect.left, half), rect.width - half),
        y: Math.min(Math.max(event.clientY - rect.top, half), rect.height - half),
      }
      placeBase()
    }

    update(event.clientX, event.clientY)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointer.current) return
    update(event.clientX, event.clientY)
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointer.current) return
    zoneRef.current?.releasePointerCapture(event.pointerId)
    release()
  }

  // Si el componente se desmonta con el dedo puesto, la cámara se quedaría
  // girando para siempre. Un (0,0) de despedida lo evita.
  useEffect(() => () => onChange(0, 0), [onChange])

  return (
    <div
      ref={zoneRef}
      role="application"
      aria-label={label}
      // touch-none es obligatorio: sin él, el navegador se queda con el gesto
      // para hacer scroll y el joystick deja de recibir pointermove.
      className={`pointer-events-auto relative touch-none select-none ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={release}
    >
      {/* Base */}
      <div
        ref={baseRef}
        style={{ width: size, height: size }}
        className={`absolute left-0 top-0 rounded-full transition-opacity duration-200 ${
          active ? 'opacity-100' : 'opacity-60'
        }`}
      >
        <div className="hud-glass absolute inset-0 rounded-full" />

        {/* Cruceta tenue, para que se lea como control y no como botón */}
        <div className="absolute inset-0 grid place-items-center opacity-40">
          <div className="h-px w-2/3 bg-white/30" />
          <div className="absolute h-2/3 w-px bg-white/30" />
        </div>

        {/* Aro que se enciende al agarrarlo */}
        <div
          className={`absolute inset-0 rounded-full ring-2 transition-colors duration-200 ${
            /* `ring-brand-400` plano y no `ring-brand-400/80`: las utilidades
               con alfa compilan a un rgba() con el color QUEMADO como respaldo
               para Safari < 16.2, así que con una marca ajena el aro se quedaba
               ámbar. La opacidad se pone aparte, que sí respeta el token en
               cualquier navegador. Ver src/lib/marca.ts. */
            active ? 'ring-brand-400 opacity-90' : 'ring-white/10'
          }`}
        />

        {/* Knob */}
        <div
          ref={knobRef}
          style={{ width: knobSize, height: knobSize }}
          className={`absolute left-1/2 top-1/2 rounded-full bg-white/90 shadow-lg shadow-black/50 ring-1 ring-black/20 ${
            active ? '' : 'transition-transform duration-200 ease-out'
          }`}
        >
          <div
            className={`absolute inset-[6px] rounded-full transition-colors duration-200 ${
              active ? 'bg-brand-500' : 'bg-ink-700'
            }`}
          />
        </div>
      </div>
    </div>
  )
}

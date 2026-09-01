import { useEffect, useRef } from 'react'
import * as THREE from 'three'

import type { PuntoGuia } from '../../lib/capture/plan'
import type { OrientationReading } from '../../lib/capture/orientation'
import { DEG, yawPitchToScreenQ } from '../../lib/math'

export type GuiaCapturaProps = {
  puntos: PuntoGuia[]
  /** Ids ya fotografiados. Es un Set MUTABLE que se lee en cada cuadro. */
  hechos: React.RefObject<Set<string>>
  lectura: OrientationReading
  /** Campo de visión VERTICAL de lo que se ve en pantalla, en grados. */
  fovPantalla: number
  /** Id del punto al que hay que apuntar ahora. Se lee en cada cuadro. */
  objetivo: React.RefObject<string | null>
  /** 0…1 de la espera antes de disparar. Se lee en cada cuadro. */
  asentado: React.RefObject<number>
}

const COLOR_PENDIENTE = 'rgba(255,255,255,0.55)'
const COLOR_HECHO = 'rgba(120, 220, 150, 0.9)'
const COLOR_OBJETIVO = '#f0a52e'

/**
 * ============================================================================
 *  LOS PUNTOS GUÍA SOBRE LA IMAGEN DE LA CÁMARA
 * ============================================================================
 *
 * Dibuja, encima del video, a dónde falta apuntar. Usa exactamente la misma
 * proyección que los hotspots del visor, solo que la "cámara" no es la del
 * recorrido sino el propio teléfono.
 *
 * Todo se pinta en un canvas dentro de su propio requestAnimationFrame, sin
 * pasar por el estado de React: los sensores entregan unas 60 lecturas por
 * segundo y cada una movería todos los puntos.
 *
 * Cuando el punto al que hay que apuntar queda FUERA de la pantalla se dibuja
 * una flecha en la orilla. Sin eso, el usuario que se pasó de vuelta no tiene
 * forma de saber para dónde regresar y termina girando en círculos.
 */
export function GuiaCaptura({
  puntos,
  hechos,
  lectura,
  fovPantalla,
  objetivo,
  asentado,
}: GuiaCapturaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    const inversa = new THREE.Quaternion()
    const punto = new THREE.Vector3()

    const dibujar = () => {
      frame = requestAnimationFrame(dibujar)

      const ancho = canvas.clientWidth
      const alto = canvas.clientHeight
      if (ancho === 0 || alto === 0) return

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (canvas.width !== Math.round(ancho * dpr) || canvas.height !== Math.round(alto * dpr)) {
        canvas.width = Math.round(ancho * dpr)
        canvas.height = Math.round(alto * dpr)
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, ancho, alto)

      // Se usa la orientación SUAVIZADA: los puntos se ven pegados a la escena
      // en vez de vibrar con el ruido del sensor.
      inversa.copy(lectura.suave).invert()

      const centroX = ancho / 2
      const centroY = alto / 2
      const idObjetivo = objetivo.current
      let objetivoEnPantalla = false
      let direccionObjetivo: { x: number; y: number } | null = null

      for (const p of puntos) {
        const hecho = hechos.current.has(p.id)
        const esObjetivo = p.id === idObjetivo
        const posicion = yawPitchToScreenQ(p.yaw, p.pitch, inversa, fovPantalla, ancho, alto, punto)

        if (!posicion) {
          if (esObjetivo) {
            // Está detrás: la flecha apunta hacia el lado por el que queda más cerca.
            const dx = punto.x
            direccionObjetivo = { x: dx >= 0 ? 1 : -1, y: 0 }
          }
          continue
        }

        const dentro =
          posicion.x > -40 && posicion.x < ancho + 40 && posicion.y > -40 && posicion.y < alto + 40

        if (esObjetivo) {
          if (dentro) objetivoEnPantalla = true
          else direccionObjetivo = { x: posicion.x - centroX, y: posicion.y - centroY }
        }

        if (!dentro) continue

        const radio = esObjetivo ? 22 : 11
        ctx.beginPath()
        ctx.arc(posicion.x, posicion.y, radio, 0, Math.PI * 2)

        if (hecho) {
          ctx.fillStyle = COLOR_HECHO
          ctx.globalAlpha = 0.35
          ctx.fill()
          ctx.globalAlpha = 1
          ctx.strokeStyle = COLOR_HECHO
          ctx.lineWidth = 2
          ctx.stroke()
        } else {
          ctx.strokeStyle = esObjetivo ? COLOR_OBJETIVO : COLOR_PENDIENTE
          ctx.lineWidth = esObjetivo ? 3 : 2
          ctx.stroke()
          if (esObjetivo) {
            const progreso = asentado.current

            /* Mientras se sostiene la mira, el anillo deja de latir y se
               convierte en una cuenta que se cierra: la espera tiene que
               VERSE, o dos segundos sin que pase nada se leen como que la app
               se trabó y la persona se mueve justo antes del disparo. */
            if (progreso > 0) {
              ctx.beginPath()
              ctx.arc(
                posicion.x,
                posicion.y,
                radio + 8,
                -Math.PI / 2,
                -Math.PI / 2 + progreso * Math.PI * 2,
              )
              ctx.strokeStyle = COLOR_OBJETIVO
              ctx.lineWidth = 4
              ctx.lineCap = 'round'
              ctx.stroke()
              ctx.lineCap = 'butt'
            } else {
              // Un anillo que late para que se distinga del resto de un vistazo.
              const pulso = 1 + 0.18 * Math.sin(performance.now() / 260)
              ctx.beginPath()
              ctx.arc(posicion.x, posicion.y, radio * pulso + 6, 0, Math.PI * 2)
              ctx.strokeStyle = 'rgba(240,165,46,0.35)'
              ctx.lineWidth = 2
              ctx.stroke()
            }
          }
        }
      }

      /* Mira central: la referencia de a dónde está apuntando la cámara. */
      ctx.strokeStyle = objetivoEnPantalla ? COLOR_OBJETIVO : 'rgba(255,255,255,0.5)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(centroX - 16, centroY)
      ctx.lineTo(centroX - 5, centroY)
      ctx.moveTo(centroX + 5, centroY)
      ctx.lineTo(centroX + 16, centroY)
      ctx.moveTo(centroX, centroY - 16)
      ctx.lineTo(centroX, centroY - 5)
      ctx.moveTo(centroX, centroY + 5)
      ctx.lineTo(centroX, centroY + 16)
      ctx.stroke()

      /* Flecha en la orilla hacia el punto que falta. */
      if (direccionObjetivo) {
        const largo = Math.hypot(direccionObjetivo.x, direccionObjetivo.y) || 1
        const ux = direccionObjetivo.x / largo
        const uy = direccionObjetivo.y / largo
        const radio = Math.min(ancho, alto) * 0.34
        const x = centroX + ux * radio
        const y = centroY + uy * radio
        const angulo = Math.atan2(uy, ux)

        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(angulo)
        ctx.fillStyle = COLOR_OBJETIVO
        ctx.beginPath()
        ctx.moveTo(18, 0)
        ctx.lineTo(-10, 12)
        ctx.lineTo(-4, 0)
        ctx.lineTo(-10, -12)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }

      /* Aviso de teléfono ladeado: en la costura, un ladeo fuerte no rompe nada
         (el cuaternión lo lleva completo), pero incomoda al usuario y hace que
         los puntos guía se vean girados, así que vale la pena decirlo. */
      const ladeo = Math.abs(((lectura.roll + 180) % 360) - 180)
      if (ladeo > 22 && ladeo < 158) {
        ctx.save()
        ctx.translate(centroX, alto - 96)
        ctx.rotate(-lectura.roll * DEG)
        ctx.strokeStyle = 'rgba(240,165,46,0.85)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(-34, 0)
        ctx.lineTo(34, 0)
        ctx.stroke()
        ctx.restore()
      }
    }

    frame = requestAnimationFrame(dibujar)
    return () => cancelAnimationFrame(frame)
  }, [puntos, hechos, lectura, fovPantalla, objetivo, asentado])

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
}

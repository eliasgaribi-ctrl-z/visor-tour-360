import type { Tour } from '../lib/types'
import { asset } from '../lib/assets'

/**
 * Recorrido de ejemplo.
 *
 * Las imágenes son panorámicas equirectangulares SINTÉTICAS, generadas para
 * probar que la cámara y el joystick están bien conectados: traen rejilla,
 * horizonte y las letras N / E / S / O en su yaw correcto (N al frente,
 * E a 90° a la derecha, S a 180°, O a 90° a la izquierda).
 *
 * ── Para meter tus fotos reales ────────────────────────────────────────────
 *   1. Deja los JPG en  public/panoramas/
 *   2. Que sean equirectangulares 2:1 (p.ej. 6000×3000 u 8192×4096).
 *      Para web, 4096×2048 en JPG calidad 80 es el punto dulce: se ve bien y
 *      pesa ~1 MB. Arriba de 8192 px muchos celulares ya no pueden con la textura.
 *   3. Cambia `image` aquí y ajusta los hotspots (yaw/pitch en GRADOS).
 *
 * Para cazar los ángulos de un hotspot sin adivinar: abre el visor, mueve la
 * cámara hasta apuntar al lugar exacto y lee el ángulo en el panel de depuración
 * (el badge de abajo a la izquierda en modo dev).
 */
export const demoTour: Tour = {
  title: 'Recorrido virtual',
  subtitle: 'Demo · panorámicas de prueba',
  startSceneId: 'sala',
  scenes: [
    {
      id: 'sala',
      name: 'Sala',
      image: asset('panoramas/sala.jpg'),
      initialYaw: 0,
      hotspots: [
        { id: 'sala-a-cocina', kind: 'link', to: 'cocina', label: 'Cocina', yaw: 62, pitch: -6 },
        { id: 'sala-a-recamara', kind: 'link', to: 'recamara', label: 'Recámara', yaw: -74, pitch: -6 },
        {
          id: 'sala-info',
          kind: 'info',
          label: 'Sala 4.2 × 3.8 m',
          body: 'Doble altura, salida a patio y preparación para minisplit.',
          yaw: 168,
          pitch: 4,
        },
      ],
    },
    {
      id: 'cocina',
      name: 'Cocina',
      image: asset('panoramas/cocina.jpg'),
      initialYaw: 0,
      hotspots: [
        { id: 'cocina-a-sala', kind: 'link', to: 'sala', label: 'Volver a sala', yaw: -118, pitch: -8 },
        { id: 'cocina-a-recamara', kind: 'link', to: 'recamara', label: 'Recámara', yaw: 96, pitch: -8 },
      ],
    },
    {
      id: 'recamara',
      name: 'Recámara',
      image: asset('panoramas/recamara.jpg'),
      initialYaw: 0,
      hotspots: [
        { id: 'recamara-a-sala', kind: 'link', to: 'sala', label: 'Volver a sala', yaw: 130, pitch: -8 },
        {
          id: 'recamara-info',
          kind: 'info',
          label: 'Clóset',
          body: 'Clóset de 1.80 m con entrepaños. Ventana a la calle.',
          yaw: -40,
          pitch: 0,
        },
      ],
    },
  ],
}

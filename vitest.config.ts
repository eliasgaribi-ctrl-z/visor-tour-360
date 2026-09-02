import { defineConfig } from 'vitest/config'

/**
 * Configuración aparte de la de Vite, a propósito.
 *
 * Si no existe este archivo, Vitest levanta el `vite.config.ts` del proyecto
 * entero: React, Tailwind y el plugin que aplana las capas del CSS. Nada de
 * eso pinta un solo píxel en las pruebas —son funciones puras de geometría,
 * de bytes y de ZIP— y a cambio cada corrida paga el arranque de Tailwind.
 *
 * `environment: 'node'` porque ninguna prueba toca el DOM. Lo que sí usan
 * —Blob, TextEncoder, DecompressionStream— son globales de Node desde la 18,
 * así que no hace falta simular un navegador.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})

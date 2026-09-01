import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    /**
     * Vite compila por defecto para navegadores "modernos" (Safari 16 y arriba).
     * Eso deja fuera a un iPhone que no se ha actualizado, y el fallo no se ve
     * como un error: el navegador no puede ni leer el archivo, así que no
     * ejecuta nada y la pantalla se queda en negro.
     *
     * Un recorrido de una casa lo abre quien sea con el teléfono que traiga, así
     * que bajamos el objetivo hasta Safari 13 (iOS 13, de 2019). El bundle
     * engorda un poco; a cambio abre en cualquier celular.
     */
    target: ['es2017', 'safari13', 'chrome80', 'firefox78'],
  },
  server: {
    // Permite abrir el visor desde el celular en la misma red Wi-Fi:
    // npm run dev  ->  usa la URL "Network" que imprime Vite.
    host: true,
  },
})

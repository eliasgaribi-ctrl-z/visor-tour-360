import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Permite abrir el visor desde el celular en la misma red Wi-Fi:
    // npm run dev  ->  usa la URL "Network" que imprime Vite.
    host: true,
  },
})

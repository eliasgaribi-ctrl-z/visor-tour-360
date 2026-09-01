import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/**
 * Si un trozo de la app no se puede descargar, recargar.
 *
 * Las cinco pantallas 3D se cargan con `lazy()`, o sea que su archivo llega
 * cuando el usuario entra a la pantalla, no al abrir el sitio. Si esa descarga
 * falla —se cayó la red del celular a media casa, o se publicó una versión
 * nueva y los archivos viejos ya no están— la promesa se rechaza y React se
 * lleva por delante el árbol entero: pantalla negra, sin explicación.
 *
 * Vite ya avisa de eso con un evento y hasta ahora nadie lo escuchaba. En el
 * caso más común —el despliegue nuevo— recargar arregla de verdad, porque trae
 * el index.html nuevo con los nombres de archivo nuevos.
 */
window.addEventListener('vite:preloadError', () => {
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

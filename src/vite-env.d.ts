/// <reference types="vite/client" />

/**
 * Lo que se puede fijar al compilar.
 *
 * Sin esto, `import.meta.env.LO_QUE_SEA` compila con tipo `any` y un nombre mal
 * escrito no se nota hasta que la función simplemente no aparece en el teléfono.
 */
interface ImportMetaEnv {
  /**
   * Dirección del Worker que guarda las casas publicadas, sin barra final.
   * Ver worker/ y la sección de publicación del README.
   *
   * Si no se pone, la app funciona igual pero sin publicar: los recorridos
   * siguen viviendo en el teléfono y el botón ni aparece.
   */
  readonly VITE_PUBLICAR_BASE?: string
  /**
   * `1` en el build que arma `tools/sitio.mjs`: la casa como sitio estático
   * autocontenido. El visor lee `recorrido/tour.json` de su propia carpeta y no
   * enseña ninguna pantalla de crear. No se pone a mano: la pone la herramienta.
   */
  readonly VITE_SITIO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

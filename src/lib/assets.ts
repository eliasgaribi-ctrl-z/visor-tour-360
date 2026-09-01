/**
 * Resuelve la ruta de un archivo de `public/` contra la base del sitio.
 *
 * Por qué existe: una ruta absoluta como `/panoramas/sala.jpg` solo funciona si
 * el visor vive en la raíz del dominio. En GitHub Pages la URL es
 * `usuario.github.io/repositorio/`, así que `/panoramas/...` se va a la raíz del
 * dominio y devuelve 404 — pantalla negra, sin ningún error visible.
 *
 * Vite reescribe las rutas de los assets que él procesa, pero NO las cadenas de
 * texto que apuntan a `public/`. Esas hay que resolverlas a mano, y este es el
 * único lugar donde se hace.
 *
 * Las data: URIs y las URLs absolutas pasan intactas: el build de un solo
 * archivo mete las panorámicas como data: URI y no hay que tocarlas.
 */
export function asset(path: string): string {
  if (/^(data:|blob:|https?:)/i.test(path)) return path
  const base = import.meta.env.BASE_URL || '/'
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

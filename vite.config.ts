import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * ============================================================================
 *  APLANAR LAS CAPAS DE CASCADA DEL CSS
 * ============================================================================
 *
 * Tailwind v4 envuelve TODO lo que genera en `@layer` (properties, theme, base,
 * utilities). `@layer` existe desde Safari 15.4, y una regla-arroba que el
 * navegador no conoce no se ignora a medias: se descarta ELLA Y SU BLOQUE.
 *
 * Medido en la hoja publicada: 44 109 de 48 672 bytes, el 90.6 %, viven dentro
 * de una capa. Ahí está todo — el preflight, los colores, `.absolute`, `.flex`,
 * `.hud-glass`, y hasta la propia `.alto-pantalla` que se escribió para que un
 * iPhone viejo no se quedara sin altura. O sea que en Safari 13 la app monta y
 * se pinta sin UNA SOLA regla de estilo, y encima falla en silencio: la red de
 * seguridad de index.html solo se dispara si #root está vacío, y aquí no lo
 * está.
 *
 * No hay opción de configuración que lo evite. Lightning CSS tampoco: se probó
 * con targets safari13 y las capas salen intactas, porque no existe forma
 * general de bajarlas (su semántica es de ORDEN, no de sintaxis).
 *
 * Aplanar sí se puede, y aquí es seguro, por dos razones concretas:
 *
 *   · Tailwind emite las capas en el mismo orden en que manda su precedencia
 *     (properties → theme → base → utilities), así que quitar los envoltorios
 *     deja la cascada igual: gana lo de más abajo, que es lo que ya ganaba.
 *   · La única regla del proyecto que depende de las capas es el override de
 *     `.animate-ping` de src/index.css, que a propósito vive FUERA de toda capa
 *     y se emite después de `utilities`. Misma especificidad (0-1-0), así que
 *     sigue ganando por orden de fuente.
 *
 * Se hace sobre el bundle ya generado y no con una expresión regular sobre el
 * texto: los bloques `@layer` llevan `@media` y `@supports` anidados dentro, y
 * una regex plana corta en la llave equivocada.
 */
function aplanarCapas(): Plugin {
  return {
    name: 'aplanar-capas',
    generateBundle(_opciones, bundle) {
      for (const archivo of Object.values(bundle)) {
        if (archivo.type !== 'asset') continue
        if (!archivo.fileName.endsWith('.css')) continue
        archivo.source = desenvolver(String(archivo.source))
      }
    },
  }
}

/**
 * Quita los envoltorios `@layer nombre { ... }` dejando su contenido en el
 * mismo sitio, y borra las declaraciones sueltas `@layer a, b;` (que solo
 * anuncian el orden y sin capas no significan nada).
 *
 * Cuenta llaves en vez de confiar en una regex, y respeta las cadenas: un
 * `content: "}"` dentro del CSS descuadraría la cuenta.
 */
function desenvolver(css: string): string {
  let salida = ''
  let i = 0

  while (i < css.length) {
    const inicio = css.indexOf('@layer', i)
    if (inicio === -1) {
      salida += css.slice(i)
      break
    }

    // Lo de antes de la capa se copia tal cual.
    salida += css.slice(i, inicio)

    // ¿Es un bloque `@layer x { ... }` o una declaración `@layer a, b;`?
    let j = inicio + '@layer'.length
    while (j < css.length && css[j] !== '{' && css[j] !== ';') j++

    if (css[j] === ';') {
      // Declaración de orden: se tira entera.
      i = j + 1
      continue
    }
    if (j >= css.length) {
      // `@layer` suelto al final, sin bloque ni punto y coma: no debería pasar.
      salida += css.slice(inicio)
      break
    }

    const fin = cerrarLlave(css, j)
    if (fin === -1) {
      // Sin cierre: mejor dejarlo como está que romper la hoja.
      salida += css.slice(inicio)
      break
    }

    // El contenido puede traer capas anidadas, así que se procesa también.
    salida += desenvolver(css.slice(j + 1, fin))
    i = fin + 1
  }

  return salida
}

/** Índice de la llave que cierra la que abre en `apertura`, o -1. */
function cerrarLlave(css: string, apertura: number): number {
  let nivel = 0
  let comilla: string | null = null

  for (let k = apertura; k < css.length; k++) {
    const c = css[k]

    if (comilla) {
      if (c === '\\') k++
      else if (c === comilla) comilla = null
      continue
    }
    if (c === '"' || c === "'") {
      comilla = c
      continue
    }
    if (c === '{') nivel++
    else if (c === '}') {
      nivel--
      if (nivel === 0) return k
    }
  }
  return -1
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), aplanarCapas()],
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
     *
     * ── Ojo: esto son DOS pisos, no uno ────────────────────────────────────
     *
     * Este target hace que el archivo se pueda LEER y que la app MONTE en un
     * Safari 13. No hace que el recorrido se vea: three.js r185 pide un
     * contexto `webgl2` y nada más, y WebGL 2 llegó a Safari en la 15. En un
     * iPhone con iOS 13 o 14 el visor 3D y la captura NO pueden funcionar.
     *
     *   · cargar la página, el menú, editar el recorrido, importar y exportar
     *     el .tour  →  desde Safari 13
     *   · ver el recorrido en 3D y capturar con la cámara  →  desde Safari 15
     *
     * Por eso el target sigue valiendo la pena aunque el visor no abra ahí:
     * es lo que permite que el teléfono llegue vivo hasta un mensaje que
     * explique qué pasa, en vez de quedarse en negro sin decir nada.
     */
    target: ['es2017', 'safari13', 'chrome80', 'firefox78'],
  },
  server: {
    // Permite abrir el visor desde el celular en la misma red Wi-Fi:
    // npm run dev  ->  usa la URL "Network" que imprime Vite.
    host: true,
  },
})

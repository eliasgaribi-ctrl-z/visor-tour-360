import type { Ficha, Hotspot, Marca } from '../types'

/**
 * ============================================================================
 *  MODELO DE LO QUE SE GUARDA EN EL TELÉFONO
 * ============================================================================
 *
 * Hay DOS modelos de recorrido y conviene no confundirlos:
 *
 *   Tour        (src/lib/types.ts)  ·  el que consume el visor.
 *                                     `image` es una URL que el navegador puede
 *                                     descargar: /panoramas/sala.jpg, blob:… o data:…
 *
 *   StoredTour  (este archivo)      ·  el que vive en IndexedDB.
 *                                     `imageId` es la LLAVE de un Blob guardado
 *                                     aparte, no una URL.
 *
 * Se guardan así, separados, por dos razones:
 *   · un Blob de 1.5 MB dentro del JSON del recorrido obligaría a leer y
 *     reescribir todas las fotos cada vez que se renombra una habitación;
 *   · las URLs `blob:` mueren al recargar la página, así que no se pueden
 *     guardar: hay que volver a crearlas al abrir el recorrido.
 *
 * `resolveTour()` (en ./tours.ts) es el puente entre los dos.
 */

/** Cómo llegó la foto al recorrido. Solo informativo, para la UI. */
export type SceneOrigin = 'captura' | 'foto'

export type StoredScene = {
  id: string
  name: string
  /** Llave del Blob de la equirectangular 2:1 en el store de imágenes. */
  imageId: string
  /** Llave del Blob de la miniatura (JPEG chico). */
  thumbId?: string
  /** Yaw al entrar a la habitación, en grados. */
  initialYaw?: number
  hotspots: Hotspot[]
  origin?: SceneOrigin
  /** Grados de círculo que cubre la foto: 360 = esfera completa. */
  coverageDeg?: number
  /**
   * Rumbo real al que mira el FRENTE de la panorámica: 0 = norte, creciendo a
   * la derecha, igual que `webkitCompassHeading`.
   *
   * Solo lo traen las escenas capturadas en un teléfono con brújula. Una foto
   * importada no tiene sensor detrás y aquí va `undefined`, que es distinto de
   * cero: la brújula del visor lo detecta y etiqueta su disco "frente" en vez de
   * "N". Ver `src/lib/rumbo.ts`, incluido de dónde sale el signo.
   */
  rumbo?: number
  /**
   * Corrección de nivel al VER, en grados: `tiltX` sube/baja el horizonte del
   * frente, `tiltZ` lo ladea a los costados. Ausente = cero. Se aplica rotando la
   * esfera, no la foto; ver `src/lib/nivel.ts`, incluido por qué no hay semilla
   * automática desde las tomas.
   */
  nivel?: { tiltX: number; tiltZ: number }
  createdAt: number
}

/**
 * La marca como se guarda: igual que `Marca`, pero el logo es una LLAVE de Blob
 * y no una URL. Mismo patrón que `imageId` en las escenas, y por la misma razón:
 * las URLs `blob:` mueren al recargar la página.
 */
export type MarcaGuardada = Omit<Marca, 'logo'> & { logoId?: string }

export type StoredTour = {
  id: string
  /**
   * Con qué versión del formato se escribió este registro.
   *
   * ── Por qué un número guardado y no uno deducido ──────────────────────────
   *
   * `.tour` tiene `version` dentro del manifiesto desde el principio; IndexedDB
   * no tenía nada. Y el `.tour` es el respaldo: **el trabajo real vive en
   * IndexedDB**, así que ahí faltaba justo donde más importa. El escenario es
   * concreto: cuando llegue la v3, los archivos suben por su peldaño `de2a3` y
   * los cuarenta recorridos que el agente ya tiene en el teléfono no suben por
   * ninguno, porque no hay número al que preguntarle qué forma tienen.
   *
   * Un registro SIN estampa se toma como 2, y eso no es una suposición
   * cómoda: el salto de 1 a 2 fue puramente aditivo (`marca` y `ficha`, las dos
   * opcionales), así que un registro escrito por el código v1 y uno escrito por
   * el v2 tienen la misma forma. Leerlos como 2 es correcto para los dos.
   *
   * `DB_VERSION` de `idb.ts` es otra cosa y no se confunde con esta: esa dice
   * qué ALMACENES existen, esta dice qué forma tienen los registros de dentro.
   */
  formato?: number
  title: string
  subtitle?: string
  startSceneId: string
  scenes: StoredScene[]
  /** Cómo se viste el visor. Ver `src/lib/marca.ts`. */
  marca?: MarcaGuardada
  /** Los datos de la casa que se muestran en la portada. */
  ficha?: Ficha
  /** Modo kiosco: gira solo al abrirlo. Opcional y aditivo, como `marca` y `ficha`. */
  autogiro?: boolean
  createdAt: number
  updatedAt: number
  /**
   * Cómo está publicada esta casa en el servidor, si lo está.
   *
   * `llave` es la del link. Se guarda para poder volver a compartir el mismo
   * link, para volver a publicar SOBRE él (y no crear otro cada vez) y, sobre
   * todo, para poder BAJARLA: sin esto, publicar sería una puerta de un solo
   * sentido y una casa vendida se quedaría en línea para siempre.
   *
   * `publicadoEn` es cuándo se subió lo que hoy enseña el link. Se compara con
   * `updatedAt`: si el recorrido cambió después, el link enseña la versión
   * vieja y hay que decirlo —es la queja de soporte número uno si falta—. Por
   * eso anotar la publicación se guarda SIN mover `updatedAt` (ver
   * `saveTour`): publicar no es editar la casa.
   *
   * `editToken` es el secreto que autoriza a volver a publicar y a bajar esta
   * llave en concreto. Solo existe en este teléfono.
   *
   * A propósito NO viaja dentro del `.tour`: si dos personas importaran el
   * mismo archivo, las dos creerían mandar sobre la misma publicación y la
   * segunda podría tirar la del primero sin enterarse. Y el token menos aún: un
   * `.tour` se manda por WhatsApp.
   */
  publicacion?: { llave: string; editToken?: string; publicadoEn: number }
  /**
   * La forma vieja de `publicacion`: solo la llave. `normalizarTour` la sube al
   * campo nuevo al leer; ningún código nuevo la escribe.
   */
  publicadoComo?: string
}

/** Fila del listado de recorridos: lo mínimo para pintar la portada. */
export type TourSummary = {
  id: string
  title: string
  subtitle?: string
  scenes: number
  updatedAt: number
  /** Llave del Blob de la miniatura de la primera habitación. */
  coverId?: string
}

/**
 * Versión del formato `.tour`.
 *
 *   1 → el original.
 *   2 → agrega `marca` y `ficha` al recorrido. Los dos OPCIONALES, así que un
 *       archivo v1 se lee sin tocar nada (ver `src/lib/store/migrar.ts`).
 *
 * `importarTour` rechaza `version > FORMAT_VERSION` con un mensaje que dice
 * "actualiza la página", y eso es lo correcto: un lector viejo frente a un
 * archivo nuevo tiene que avisar, no adivinar ni quedarse en negro.
 */
export const FORMAT_VERSION = 2

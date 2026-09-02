/**
 * ============================================================================
 *  ¿QUÉ TAN FUERTE ES ESTE APARATO?
 * ============================================================================
 *
 * Una sola respuesta, en un solo lugar, porque de ella dependen CUATRO decisiones
 * que tienen que ser coherentes entre sí: a qué resolución se dibuja, a qué
 * tamaño se suben las fotos a la tarjeta gráfica, cuántas habitaciones se
 * precargan, y cuántas se quedan en el caché de texturas. Si cada una lo
 * decidiera por su cuenta, se contradirían.
 *
 * ── El problema de fondo ───────────────────────────────────────────────────
 *
 * Un JPEG de 1 MB no ocupa 1 MB en la tarjeta gráfica: se descomprime. Una
 * equirectangular de 4096×2048 son 4096 · 2048 · 4 bytes = 33 MB, más un tercio
 * de mipmaps: unos 45 MB por habitación. Safari en iOS tumba la pestaña
 * alrededor de los 384 MB de memoria de video, así que ocho habitaciones
 * cargadas a la vez ya no caben.
 *
 * Bajar la foto a 2048 de ancho la deja en 8 MB: la cuarta parte. Y como en un
 * aparato modesto además se dibuja a 1x, en pantalla se ve prácticamente igual:
 * a 75° de campo de visión se ve como un quinto del ancho de la panorámica, o
 * sea 410 px de textura repartidos en los 390 px de la pantalla. No sobra
 * resolución que perder.
 *
 * ── Cómo se detecta ────────────────────────────────────────────────────────
 *
 * `navigator.deviceMemory` no existe en Safari ni en Firefox, así que no puede
 * ser la única señal; se combina con el número de núcleos, que sí reportan
 * todos. La detección se hace UNA vez: ninguno de estos valores cambia.
 */

export type Aparato = {
  /** Poca memoria: hay que ahorrar en todo. */
  modesto: boolean
  /** Ancho máximo al que se sube una panorámica a la tarjeta gráfica. */
  anchoTextura: number
  /** Cuántas habitaciones vecinas se precargan. */
  precargas: number
  /**
   * Cuántas panorámicas se quedan en el caché de texturas antes de soltar las
   * viejas.
   *
   * Vive aquí y no en `useEquirectTexture` porque es la CUARTA decisión del
   * mismo presupuesto, y las cuatro tienen que ser coherentes: no sirve bajar
   * `anchoTextura` para ahorrar memoria si el tope del caché sigue siendo el
   * mismo número de fotos, ni al revés. Estaba suelta como constante en el otro
   * archivo, que es el único lugar del proyecto donde una decisión de
   * presupuesto no pasaba por aquí.
   *
   * Hoy vale 5 en los dos aparatos. Que sean iguales no es un descuido: el
   * aparato modesto ya ahorra por el lado de la resolución, y bajarle además el
   * caché solo le costaría recargas sin necesidad.
   *
   * ── Cuidado al leer los números, porque hay DOS ────────────────────────
   *
   * `memoria.mjs` reporta 160 MB con 5 en caché en un aparato normal (40 MB en
   * gama baja), y esos son los que están en la tabla del README §10. Pero cuenta
   * el NIVEL 0 de cada textura: 4096·2048·4 = 33.6 MB. Lo residente de verdad
   * incluye los mipmaps, un tercio más.
   *
   * Para que no haya un tercer número flotando, la cuenta se hace una sola vez y
   * con el mismo redondeo que la cabecera de este archivo:
   *
   *     nivel 0        33.6 MB   ·  con mipmaps  ~45 MB   (aparato normal)
   *     × 5 en caché   168 MB    ·  con mipmaps  ~224 MB
   *
   * O sea que los 160 MB medidos son nivel 0 —cuadran con los 168 teóricos— y lo
   * residente ronda 224. Sigue cabiendo en los ~384 MB donde Safari en iOS tumba
   * la pestaña, pero la reserva es un tercio menor de lo que sugieren los 160.
   *
   * Al subir este número, la cuenta se hace con los ~45 MB de la cabecera, no con
   * los 33.6 del nivel 0.
   */
  maximoEnCache: number
  /** Densidad de píxeles a la que se dibuja. */
  dpr: number | [number, number]
}

let cache: Aparato | null = null

export function aparato(): Aparato {
  if (cache) return cache

  const memoria = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const nucleos = navigator.hardwareConcurrency ?? 8
  const modesto = typeof memoria === 'number' ? memoria <= 3 : nucleos <= 4

  cache = modesto
    ? { modesto: true, anchoTextura: 2048, precargas: 1, maximoEnCache: 5, dpr: 1 }
    : { modesto: false, anchoTextura: 4096, precargas: 2, maximoEnCache: 5, dpr: [1, 2] }
  return cache
}

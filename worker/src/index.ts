/**
 * ============================================================================
 *  EL WORKER QUE PUBLICA UNA CASA
 * ============================================================================
 *
 * El resto del proyecto no tiene servidor: es un sitio estático y todo vive en
 * el teléfono. Este archivo es la única excepción, y existe por un motivo
 * concreto que el visor solo no podía resolver.
 *
 * Un recorrido armado en el celular se guarda en IndexedDB, que es memoria de
 * ESE teléfono. La ruta `#/ver/<id>` parece que se puede compartir, pero el id
 * se busca en el almacén de quien abre el link: al cliente le sale "no se
 * encontró". La única forma de enseñar una casa era mandar el archivo `.tour`
 * y pedirle al otro que lo importara, que nadie hace.
 *
 * Aquí la casa se sube a R2 y se devuelve un link normal.
 *
 * ── Lo que este archivo NO hace, a propósito ────────────────────────────────
 *
 * No hay cuentas, ni base de datos, ni sesiones. Un recorrido publicado son
 * unos cuantos objetos en R2 bajo una llave que nadie puede adivinar, y se
 * borra tirando esos objetos. Todo lo que hace falta para eso cabe aquí.
 *
 * ── Las tres decisiones ─────────────────────────────────────────────────────
 *
 * QUIÉN PUEDE SUBIR · una clave compartida, que viaja en el encabezado
 * Authorization y vive como secreto del Worker. NO está en el paquete de la
 * app: el JavaScript de un sitio estático es público y cualquiera lo lee, así
 * que una clave ahí dentro no es una clave. La escribe la persona una vez en su
 * teléfono y se queda en el almacenamiento local del navegador.
 *
 * Sin esto, cualquiera que encuentre la dirección puede llenar el bucket de
 * archivos ajenos, y la cuenta la paga el dueño.
 *
 * QUIÉN PUEDE VER · quien tenga el link. La llave son 128 bits de azar: no se
 * llega por probar. Y todas las respuestas llevan `X-Robots-Tag: noindex`, más
 * un robots.txt que cierra el sitio entero, porque una casa en venta puede
 * estar habitada y su interior no tiene por qué quedar en Google.
 *
 * QUÉ SE PUEDE SUBIR · solo JPEG, con tope de tamaño, de cantidad y de peso
 * total. El manifiesto se vuelve a sanear aquí aunque el teléfono ya lo haya
 * hecho: lo que viene por la red es de quien tenga la clave, y una clave
 * compartida entre varios teléfonos acaba en más manos de las previstas.
 */

export type Env = {
  /** Bucket de R2 donde viven las casas publicadas. */
  TOURS: R2Bucket
  /** Clave compartida. Se pone con `wrangler secret put CLAVE_PUBLICACION`. */
  CLAVE_PUBLICACION: string
  /**
   * De dónde se sirve la app del visor, con la barra final.
   * El link que se comparte lo abre este Worker, que rebota al visor.
   */
  APP_BASE: string
}

/* ── Topes ──────────────────────────────────────────────────────────────────
   Puestos con la vara de una casa de verdad: una equirectangular de 4096 sale
   en 1.5 MB, y una casa completa rara vez pasa de doce cuartos. Todo lo que se
   salga de eso es un error o alguien probando. */
const MAX_FOTO = 12 * 1024 * 1024
const MAX_FOTOS = 48
const MAX_MANIFIESTO = 256 * 1024
const MAX_TOTAL = 120 * 1024 * 1024

/** Alfabeto sin caracteres que se confunden al leerlos en voz alta o a mano. */
const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789'

/**
 * Llave de una casa publicada: 128 bits de azar del generador criptográfico.
 *
 * No es un identificador bonito a propósito. Es lo único que separa una casa
 * de cualquiera que pase por ahí, así que tiene que ser imposible de adivinar
 * incluso probando sin parar: con 128 bits, tocar todas las combinaciones no
 * cabe en la vida de nadie.
 */
function nuevaLlave(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let bits = 0
  let acumulado = 0
  let salida = ''
  for (const byte of bytes) {
    acumulado = (acumulado << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      salida += ALFABETO[(acumulado >> bits) & 31]
    }
  }
  if (bits > 0) salida += ALFABETO[(acumulado << (5 - bits)) & 31]
  return salida
}

/** Una llave que nosotros generamos tiene exactamente esta forma. */
const LLAVE_VALIDA = new RegExp(`^[${ALFABETO}]{26}$`)

/**
 * Nombre de foto admitido.
 *
 * Cerrado a la forma que el teléfono manda —`000.jpg`, `000.min.jpg`— y no a
 * "algo que no tenga barras". Las llaves de R2 no son rutas de disco y no hay
 * un `..` que escape a ningún lado, pero un nombre libre sí deja escribir
 * dentro del prefijo de otra casa, y de ahí sale servir un archivo cualquiera
 * desde nuestro dominio.
 */
const FOTO_VALIDA = /^[0-9]{3}(\.min)?\.jpg$/

/* ── Respuestas ──────────────────────────────────────────────────────────── */

/**
 * Encabezados que van en TODO lo que se sirve.
 *
 * El `noindex` no es simbólico: es la diferencia entre enseñarle una casa a un
 * cliente y publicar el interior de la casa de alguien en un buscador.
 *
 * El `Access-Control-Allow-Origin: *` está porque la app vive en otro dominio
 * (hoy GitHub Pages) y el visor descarga las panorámicas con `fetch` antes de
 * subirlas a la tarjeta gráfica. Sin CORS, WebGL rechaza la textura. Abrir el
 * origen no regala nada: lo que hay detrás ya es público para quien tenga el
 * link, y no hay cookies ni sesión que robar.
 */
const COMUNES: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow',
  'Access-Control-Allow-Origin': '*',
}

function json(datos: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...COMUNES, ...extra },
  })
}

function error(status: number, mensaje: string): Response {
  return json({ error: mensaje }, status)
}

/**
 * ¿Trae la clave correcta?
 *
 * La comparación recorre los dos textos completos siempre, sin cortar en la
 * primera letra distinta. Comparar con `===` tarda un poquito más cuantas más
 * letras coincidan, y esa diferencia —medida muchas veces— alcanza para ir
 * adivinando la clave letra por letra.
 */
function claveCorrecta(pedido: Request, env: Env): boolean {
  const cabecera = pedido.headers.get('Authorization') ?? ''
  const dada = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : ''
  const esperada = env.CLAVE_PUBLICACION ?? ''
  if (!esperada) return false
  const a = new TextEncoder().encode(dada)
  const b = new TextEncoder().encode(esperada)
  let diferencia = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diferencia |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diferencia === 0
}

/* ── Saneo del manifiesto ────────────────────────────────────────────────── */

const texto = (v: unknown, max: number, porDefecto: string): string =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : porDefecto

const textoOpcional = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined

const numero = (v: unknown, porDefecto = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : porDefecto

type EscenaPublica = {
  id: string
  name: string
  foto: string
  miniatura?: string
  initialYaw: number
  hotspots: unknown[]
}

/**
 * Deja el manifiesto en algo que el visor pueda pintar sin reventar.
 *
 * Se hace aquí ADEMÁS de en el teléfono. No es desconfianza del código propio:
 * es que a este endpoint llega lo que mande quien tenga la clave, y una clave
 * compartida entre los teléfonos de un equipo termina, con el tiempo, en más
 * manos de las que uno cree. Lo que se guarda aquí se lo va a comer el visor de
 * un cliente.
 */
function saneaManifiesto(crudo: unknown): { ok: true; valor: unknown } | { ok: false; por: string } {
  if (!crudo || typeof crudo !== 'object') return { ok: false, por: 'El manifiesto no es un objeto.' }
  const m = crudo as Record<string, unknown>

  const escenasCrudas = Array.isArray(m.scenes) ? m.scenes : null
  if (!escenasCrudas || escenasCrudas.length === 0) {
    return { ok: false, por: 'El recorrido no trae ninguna habitación.' }
  }
  if (escenasCrudas.length > MAX_FOTOS) {
    return { ok: false, por: `Un recorrido no puede tener más de ${MAX_FOTOS} habitaciones.` }
  }

  const vistos = new Set<string>()
  const scenes: EscenaPublica[] = []

  for (const cruda of escenasCrudas) {
    if (!cruda || typeof cruda !== 'object') continue
    const e = cruda as Record<string, unknown>

    // Sin foto no hay habitación: el visor mostraría una esfera negra.
    if (typeof e.foto !== 'string' || !FOTO_VALIDA.test(e.foto)) continue

    let id = typeof e.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(e.id) ? e.id : ''
    if (!id || vistos.has(id)) id = `h${scenes.length}`
    vistos.add(id)

    const miniatura =
      typeof e.miniatura === 'string' && FOTO_VALIDA.test(e.miniatura) ? e.miniatura : undefined

    scenes.push({
      id,
      name: texto(e.name, 60, 'Habitación'),
      foto: e.foto,
      miniatura,
      initialYaw: numero(e.initialYaw),
      hotspots: saneaHotspots(e.hotspots, vistos),
    })
  }

  if (scenes.length === 0) return { ok: false, por: 'Ninguna habitación traía una foto válida.' }

  /* Los enlaces se filtran al final y no dentro del bucle: un punto de la
     primera habitación puede apuntar legítimamente a la última, que todavía no
     se había leído. */
  const ids = new Set(scenes.map((s) => s.id))
  for (const escena of scenes) {
    escena.hotspots = escena.hotspots.filter(
      (h) => (h as { kind?: string; to?: string }).kind !== 'link' || ids.has(String((h as { to?: string }).to)),
    )
  }

  const startSceneId =
    typeof m.startSceneId === 'string' && ids.has(m.startSceneId) ? m.startSceneId : scenes[0].id

  return {
    ok: true,
    valor: {
      version: 1,
      title: texto(m.title, 80, 'Recorrido'),
      subtitle: textoOpcional(m.subtitle, 120),
      startSceneId,
      scenes,
    },
  }
}

function saneaHotspots(crudo: unknown, _ids: Set<string>): unknown[] {
  if (!Array.isArray(crudo)) return []
  const salida: unknown[] = []
  for (const h of crudo.slice(0, 100)) {
    if (!h || typeof h !== 'object') continue
    const c = h as Record<string, unknown>
    if (c.kind !== 'link' && c.kind !== 'info') continue
    const base = {
      id: typeof c.id === 'string' ? c.id.slice(0, 64) : `p${salida.length}`,
      yaw: numero(c.yaw),
      pitch: Math.max(-85, Math.min(85, numero(c.pitch))),
      label: texto(c.label, 80, 'Punto'),
    }
    if (c.kind === 'link') {
      if (typeof c.to !== 'string' || !c.to) continue
      salida.push({
        ...base,
        kind: 'link',
        to: c.to.slice(0, 64),
        arriveYaw: typeof c.arriveYaw === 'number' && Number.isFinite(c.arriveYaw) ? c.arriveYaw : undefined,
      })
    } else {
      salida.push({ ...base, kind: 'info', body: textoOpcional(c.body, 2000) })
    }
  }
  return salida
}

/* ── La página que ve WhatsApp ───────────────────────────────────────────── */

function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

/**
 * La casa se comparte por WhatsApp, y el robot que arma la tarjeta de vista
 * previa NO ejecuta JavaScript: si le mandáramos directo la app, leería el
 * index.html vacío y enseñaría un link pelón. Por eso el link que se comparte
 * apunta aquí: esta página trae el título, la descripción y la miniatura ya
 * escritos en el HTML, y a una persona la rebota al visor.
 *
 * El rebote va en JavaScript y no en un 302 porque el 302 se lo llevaría también
 * el robot, que acabaría leyendo el index.html vacío de la app. Y hay un enlace
 * visible detrás, para quien tenga el JavaScript apagado.
 */
function paginaDeEnlace(env: Env, llave: string, manifiesto: { title: string; subtitle?: string; scenes: { miniatura?: string; foto: string }[] }, origen: string): Response {
  const titulo = escapar(manifiesto.title)
  const descripcion = escapar(
    manifiesto.subtitle ?? `Recorrido virtual de ${manifiesto.scenes.length} espacios.`,
  )
  const portada = manifiesto.scenes[0]
  const imagen = `${origen}/t/${llave}/fotos/${portada.miniatura ?? portada.foto}`
  const destino = `${env.APP_BASE.replace(/\/+$/, '/')}#/p/${llave}`

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${titulo}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${titulo}">
<meta property="og:description" content="${descripcion}">
<meta property="og:image" content="${escapar(imagen)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${titulo}">
<meta name="twitter:description" content="${descripcion}">
<meta name="twitter:image" content="${escapar(imagen)}">
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0b0f19;
         color:#e8eaf0; font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
         padding:24px; text-align:center }
  a { color:#e19100 }
</style>
</head>
<body>
  <div>
    <p>Abriendo <strong>${titulo}</strong>…</p>
    <p><a href="${escapar(destino)}">Si no abre solo, toca aquí</a></p>
  </div>
  <script>location.replace(${JSON.stringify(destino)})</script>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      ...COMUNES,
    },
  })
}

/* ── El Worker ───────────────────────────────────────────────────────────── */

export default {
  async fetch(pedido: Request, env: Env): Promise<Response> {
    const url = new URL(pedido.url)
    const origen = url.origin
    const partes = url.pathname.split('/').filter(Boolean)

    if (pedido.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...COMUNES,
          'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    // Un buscador que llegue por donde sea se va con las manos vacías.
    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...COMUNES },
      })
    }

    /* ── Publicar ─────────────────────────────────────────────────────────── */

    if (partes[0] === 'api') {
      if (!claveCorrecta(pedido, env)) {
        return error(401, 'Clave de publicación incorrecta.')
      }

      // POST /api/nuevo  →  { llave }
      if (pedido.method === 'POST' && partes[1] === 'nuevo' && partes.length === 2) {
        return json({ llave: nuevaLlave() })
      }

      const llave = partes[2]
      if (!llave || !LLAVE_VALIDA.test(llave)) {
        return error(400, 'Llave de recorrido inválida.')
      }

      // PUT /api/subir/<llave>/<archivo>
      if (pedido.method === 'PUT' && partes[1] === 'subir' && partes.length === 4) {
        const archivo = partes[3]
        if (!FOTO_VALIDA.test(archivo)) return error(400, 'Nombre de foto no admitido.')

        const largo = Number(pedido.headers.get('Content-Length') ?? '0')
        if (largo > MAX_FOTO) return error(413, 'Esa foto pesa demasiado.')

        const cuerpo = await pedido.arrayBuffer()
        if (cuerpo.byteLength > MAX_FOTO) return error(413, 'Esa foto pesa demasiado.')
        if (cuerpo.byteLength === 0) return error(400, 'La foto venía vacía.')

        /* Que empiece con SOI. No es una validación fuerte —nadie con la clave
           necesita engañarnos— pero atrapa el error de verdad frecuente, que es
           subir un blob equivocado y descubrirlo cuando el cliente abre el
           link y ve una esfera negra. */
        const cabecera = new Uint8Array(cuerpo.slice(0, 2))
        if (cabecera[0] !== 0xff || cabecera[1] !== 0xd8) {
          return error(400, 'Eso no es un JPEG.')
        }

        await env.TOURS.put(`t/${llave}/fotos/${archivo}`, cuerpo, {
          httpMetadata: {
            contentType: 'image/jpeg',
            /* La llave es única e irrepetible, así que el contenido de esta
               dirección no va a cambiar nunca: se puede guardar para siempre.
               Es lo que hace que volver a abrir la casa sea instantáneo. */
            cacheControl: 'public, max-age=31536000, immutable',
          },
        })
        return json({ ok: true })
      }

      // PUT /api/publicar/<llave>   ← el manifiesto, al final: es el interruptor
      if (pedido.method === 'PUT' && partes[1] === 'publicar' && partes.length === 3) {
        const largo = Number(pedido.headers.get('Content-Length') ?? '0')
        if (largo > MAX_MANIFIESTO) return error(413, 'El manifiesto es demasiado grande.')

        let crudo: unknown
        try {
          crudo = await pedido.json()
        } catch {
          return error(400, 'El manifiesto no es JSON válido.')
        }

        const saneado = saneaManifiesto(crudo)
        if (!saneado.ok) return error(400, saneado.por)

        /* Se comprueba que las fotos estén ARRIBA antes de encender el
           interruptor. Si una subida falló y nadie se dio cuenta, el cliente
           abriría la casa con un cuarto en negro; es mejor que falle aquí,
           mientras quien publica sigue mirando la pantalla. */
        const manifiesto = saneado.valor as { scenes: { foto: string; miniatura?: string }[] }
        let total = 0
        for (const escena of manifiesto.scenes) {
          const objeto = await env.TOURS.head(`t/${llave}/fotos/${escena.foto}`)
          if (!objeto) return error(409, `Falta subir la foto ${escena.foto}.`)
          total += objeto.size
        }
        if (total > MAX_TOTAL) return error(413, 'El recorrido completo pesa demasiado.')

        await env.TOURS.put(`t/${llave}/tour.json`, JSON.stringify(saneado.valor), {
          httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=60' },
        })
        return json({ ok: true, llave, url: `${origen}/t/${llave}` })
      }

      // DELETE /api/publicar/<llave>  →  bajar la casa
      if (pedido.method === 'DELETE' && partes[1] === 'publicar' && partes.length === 3) {
        /* Primero el manifiesto: en cuanto no está, el link deja de abrir. Si
           el borrado de las fotos fallara a medias, lo que queda son objetos
           huérfanos que nadie puede alcanzar, no una casa a medio enseñar. */
        await env.TOURS.delete(`t/${llave}/tour.json`)
        const listado = await env.TOURS.list({ prefix: `t/${llave}/` })
        if (listado.objects.length > 0) {
          await env.TOURS.delete(listado.objects.map((o) => o.key))
        }
        return json({ ok: true })
      }

      return error(404, 'Esa dirección no existe.')
    }

    /* ── Ver ──────────────────────────────────────────────────────────────── */

    if (partes[0] === 't' && pedido.method === 'GET') {
      const llave = partes[1]
      if (!llave || !LLAVE_VALIDA.test(llave)) return error(404, 'No existe.')

      const manifiesto = await env.TOURS.get(`t/${llave}/tour.json`)
      if (!manifiesto) return error(404, 'Este recorrido ya no está disponible.')

      // GET /t/<llave>            →  la página con la vista previa
      if (partes.length === 2) {
        const datos = (await manifiesto.json()) as Parameters<typeof paginaDeEnlace>[2]
        return paginaDeEnlace(env, llave, datos, origen)
      }

      // GET /t/<llave>/tour.json  →  lo que lee el visor
      if (partes.length === 3 && partes[2] === 'tour.json') {
        return new Response(manifiesto.body, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=60',
            ...COMUNES,
          },
        })
      }

      // GET /t/<llave>/fotos/<archivo>
      if (partes.length === 4 && partes[2] === 'fotos' && FOTO_VALIDA.test(partes[3])) {
        const foto = await env.TOURS.get(`t/${llave}/fotos/${partes[3]}`)
        if (!foto) return error(404, 'Esa foto no está.')
        return new Response(foto.body, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000, immutable',
            ...COMUNES,
          },
        })
      }

      return error(404, 'No existe.')
    }

    return error(404, 'No existe.')
  },
} satisfies ExportedHandler<Env>

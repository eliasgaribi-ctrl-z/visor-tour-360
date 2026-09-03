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
 * QUÉ SE PUEDE SUBIR · solo imágenes, con tope de tamaño, de cantidad y de peso
 * total. El manifiesto se vuelve a sanear aquí aunque el teléfono ya lo haya
 * hecho: lo que viene por la red es de quien tenga la clave, y una clave
 * compartida entre varios teléfonos acaba en más manos de las previstas.
 *
 * ── El manifiesto es la versión 2 ───────────────────────────────────────────
 *
 * La v1 llevaba las habitaciones y sus puntos. La v2 lleva además lo que hace
 * que el link sea un PRODUCTO y no una foto: la ficha de la casa (precio,
 * metros, contacto) que el visor enseña como portada y que aquí se usa para la
 * tarjeta de WhatsApp; la marca de la inmobiliaria, con su logo; el modo kiosco;
 * y por habitación el rumbo, el nivel y la cobertura. Y una variante de 2048 px
 * de cada foto, para que un teléfono modesto no baje 1.5 MB que va a encoger.
 *
 * Todo es ADITIVO y opcional: un visor cacheado de la semana pasada que lea un
 * manifiesto v2 verá menos, no verá mal. Y lo que se guarda aquí lo vuelve a
 * filtrar el visor al bajarlo (`limpiarMarca`, `limpiarFicha`, `limpiarEscena`):
 * el Worker acota tamaños y formas; el visor decide qué se puede pintar.
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
const MAX_LOGO = 1024 * 1024
const MAX_MANIFIESTO = 256 * 1024
const MAX_TOTAL = 160 * 1024 * 1024

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
 * Nombres de archivo admitidos.
 *
 * Cerrados a la forma que el teléfono manda —`000.jpg`, `000.min.jpg`,
 * `000.2k.jpg`, `logo.png`— y no a "algo que no tenga barras". Las llaves de R2
 * no son rutas de disco y no hay un `..` que escape a ningún lado, pero un
 * nombre libre sí deja escribir dentro del prefijo de otra casa, y de ahí sale
 * servir un archivo cualquiera desde nuestro dominio.
 */
const FOTO_VALIDA = /^[0-9]{3}(\.min|\.2k)?\.jpg$/
const VARIANTE_2K = /^[0-9]{3}\.2k\.jpg$/
const LOGO_VALIDO = /^logo\.(png|jpg|webp)$/
const archivoValido = (nombre: string) => FOTO_VALIDA.test(nombre) || LOGO_VALIDO.test(nombre)

/**
 * Qué tipo de imagen es, por su FIRMA y no por su extensión.
 *
 * No es una validación fuerte —nadie con la clave necesita engañarnos— pero
 * atrapa el error de verdad frecuente, que es subir un blob equivocado y
 * descubrirlo cuando el cliente abre el link y ve una esfera negra. Y como el
 * `Content-Type` con el que se sirve sale de aquí, un `logo.png` con otra cosa
 * dentro no se sirve como PNG.
 */
function tipoDeImagen(cuerpo: ArrayBuffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const b = new Uint8Array(cuerpo.slice(0, 12))
  if (b.length < 4) return null
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

/** La extensión que corresponde a cada tipo: un `logo.png` tiene que SER un PNG. */
const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

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

const numeroOpcional = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

const enteroOpcional = (v: unknown, max: number): number | undefined => {
  const n = numeroOpcional(v)
  if (n === undefined) return undefined
  const r = Math.round(n)
  return r >= 0 && r <= max ? r : undefined
}

/** Un color solo se acepta si es un hex que cualquier navegador entiende. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const colorOpcional = (v: unknown): string | undefined =>
  typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : undefined

type EscenaPublica = {
  id: string
  name: string
  foto: string
  miniatura?: string
  /** La misma foto a 2048 px, para los teléfonos que igual la iban a encoger. */
  foto2048?: string
  initialYaw: number
  hotspots: unknown[]
  rumbo?: number
  nivel?: { tiltX: number; tiltZ: number }
  coverageDeg?: number
}

type FichaPublica = {
  precio?: string
  superficie?: string
  recamaras?: number
  banos?: number
  direccion?: string
  descripcion?: string
  agente?: { nombre?: string; telefono?: string; whatsapp?: string; correo?: string }
}

type MarcaPublica = {
  nombre?: string
  colores?: Record<string, string>
  hudFondo?: string
  hudTinta?: string
  hudTintaSuave?: string
  fondoApp?: string
  tipografia?: string
  logo?: string
}

export type ManifiestoPublico = {
  version: 2
  title: string
  subtitle?: string
  startSceneId: string
  scenes: EscenaPublica[]
  ficha?: FichaPublica
  marca?: MarcaPublica
  autogiro?: boolean
}

/**
 * Deja el manifiesto en algo que el visor pueda pintar sin reventar.
 *
 * Se hace aquí ADEMÁS de en el teléfono. No es desconfianza del código propio:
 * es que a este endpoint llega lo que mande quien tenga la clave, y una clave
 * compartida entre los teléfonos de un equipo termina, con el tiempo, en más
 * manos de las que uno cree. Lo que se guarda aquí se lo va a comer el visor de
 * un cliente.
 *
 * Lo que se acota aquí son FORMAS y TAMAÑOS. Lo que significa cada cosa —si un
 * color deja legible el HUD, si un correo puede llevar un BCC escondido— lo
 * decide el visor al bajar el manifiesto, con las mismas funciones con las que
 * filtra un `.tour` ajeno. Dos filtros y no uno, porque los dos lados reciben
 * datos de una red que no controlan.
 */
function saneaManifiesto(crudo: unknown): { ok: true; valor: ManifiestoPublico } | { ok: false; por: string } {
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
    const foto2048 =
      typeof e.foto2048 === 'string' && VARIANTE_2K.test(e.foto2048) ? e.foto2048 : undefined

    const escena: EscenaPublica = {
      id,
      name: texto(e.name, 60, 'Habitación'),
      foto: e.foto,
      miniatura,
      foto2048,
      initialYaw: numero(e.initialYaw),
      hotspots: saneaHotspots(e.hotspots),
    }

    /* Los tres campos de la v2 por habitación. Se acotan igual que en el
       visor: el rumbo al círculo, el nivel a ±15, la cobertura a (0, 360]. */
    const rumbo = numeroOpcional(e.rumbo)
    if (rumbo !== undefined) escena.rumbo = ((rumbo % 360) + 360) % 360
    if (e.nivel && typeof e.nivel === 'object') {
      const n = e.nivel as Record<string, unknown>
      const tiltX = numeroOpcional(n.tiltX)
      const tiltZ = numeroOpcional(n.tiltZ)
      if (tiltX !== undefined && tiltZ !== undefined) {
        escena.nivel = {
          tiltX: Math.max(-15, Math.min(15, tiltX)),
          tiltZ: Math.max(-15, Math.min(15, tiltZ)),
        }
      }
    }
    const cobertura = numeroOpcional(e.coverageDeg)
    if (cobertura !== undefined && cobertura > 0 && cobertura <= 360) escena.coverageDeg = cobertura

    scenes.push(escena)
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

  const valor: ManifiestoPublico = {
    version: 2,
    title: texto(m.title, 80, 'Recorrido'),
    subtitle: textoOpcional(m.subtitle, 120),
    startSceneId,
    scenes,
  }

  const ficha = saneaFicha(m.ficha)
  if (ficha) valor.ficha = ficha
  const marca = saneaMarca(m.marca)
  if (marca) valor.marca = marca
  if (m.autogiro === true) valor.autogiro = true

  return { ok: true, valor }
}

function saneaHotspots(crudo: unknown): unknown[] {
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

/** La ficha de la casa, acotada campo por campo. Mismos topes que `limpiarFicha` del visor. */
function saneaFicha(crudo: unknown): FichaPublica | undefined {
  if (!crudo || typeof crudo !== 'object') return undefined
  const f = crudo as Record<string, unknown>
  const ficha: FichaPublica = {}
  const precio = textoOpcional(f.precio, 40)
  if (precio) ficha.precio = precio
  const superficie = textoOpcional(f.superficie, 40)
  if (superficie) ficha.superficie = superficie
  const recamaras = enteroOpcional(f.recamaras, 20)
  if (recamaras !== undefined) ficha.recamaras = recamaras
  const banos = enteroOpcional(f.banos, 20)
  if (banos !== undefined) ficha.banos = banos
  const direccion = textoOpcional(f.direccion, 160)
  if (direccion) ficha.direccion = direccion
  const descripcion = textoOpcional(f.descripcion, 600)
  if (descripcion) ficha.descripcion = descripcion

  if (f.agente && typeof f.agente === 'object') {
    const a = f.agente as Record<string, unknown>
    const agente: NonNullable<FichaPublica['agente']> = {}
    const nombre = textoOpcional(a.nombre, 80)
    if (nombre) agente.nombre = nombre
    const telefono = textoOpcional(a.telefono, 30)
    if (telefono) agente.telefono = telefono
    const whatsapp = textoOpcional(a.whatsapp, 20)
    if (whatsapp) agente.whatsapp = whatsapp
    const correo = textoOpcional(a.correo, 120)
    if (correo) agente.correo = correo
    if (Object.keys(agente).length > 0) ficha.agente = agente
  }
  return Object.keys(ficha).length > 0 ? ficha : undefined
}

const TOKENS_DE_COLOR = ['brand300', 'brand400', 'brand500', 'brand600', 'ink50', 'ink200', 'ink700', 'ink900']
const TIPOGRAFIAS = ['sistema', 'serif', 'geometrica']

/** La marca, acotada. Los colores tienen que ser hex; el logo, un nombre de la lista. */
function saneaMarca(crudo: unknown): MarcaPublica | undefined {
  if (!crudo || typeof crudo !== 'object') return undefined
  const m = crudo as Record<string, unknown>
  const marca: MarcaPublica = {}
  const nombre = textoOpcional(m.nombre, 60)
  if (nombre) marca.nombre = nombre

  if (m.colores && typeof m.colores === 'object') {
    const colores: Record<string, string> = {}
    for (const clave of TOKENS_DE_COLOR) {
      const c = colorOpcional((m.colores as Record<string, unknown>)[clave])
      if (c) colores[clave] = c
    }
    if (Object.keys(colores).length > 0) marca.colores = colores
  }
  for (const clave of ['hudFondo', 'hudTinta', 'hudTintaSuave', 'fondoApp'] as const) {
    const c = colorOpcional(m[clave])
    if (c) marca[clave] = c
  }
  if (typeof m.tipografia === 'string' && TIPOGRAFIAS.includes(m.tipografia)) marca.tipografia = m.tipografia
  if (typeof m.logo === 'string' && LOGO_VALIDO.test(m.logo)) marca.logo = m.logo

  return Object.keys(marca).length > 0 ? marca : undefined
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
 * La tarjeta es un ANUNCIO, no un nombre de archivo: con ficha, el título
 * empieza por el precio y la descripción es la dirección, que es lo que un
 * comprador quiere leer antes de tocar. Y `og:site_name` lleva la inmobiliaria,
 * que es a quien le importa que se vea su nombre.
 *
 * El rebote va en JavaScript y no en un 302 porque el 302 se lo llevaría también
 * el robot, que acabaría leyendo el index.html vacío de la app. Y hay un enlace
 * visible detrás, para quien tenga el JavaScript apagado.
 */
function paginaDeEnlace(env: Env, llave: string, manifiesto: ManifiestoPublico, origen: string): Response {
  const ficha = manifiesto.ficha
  const titulo = escapar(ficha?.precio ? `${ficha.precio} · ${manifiesto.title}` : manifiesto.title)
  const descripcion = escapar(
    ficha?.direccion ??
      manifiesto.subtitle ??
      `Recorrido virtual de ${manifiesto.scenes.length} ${manifiesto.scenes.length === 1 ? 'espacio' : 'espacios'}.`,
  )
  const portada = manifiesto.scenes[0]
  const imagen = `${origen}/t/${llave}/fotos/${portada.miniatura ?? portada.foto}`
  const destino = `${env.APP_BASE.replace(/\/+$/, '/')}#/p/${llave}`
  const sitio = manifiesto.marca?.nombre ? `<meta property="og:site_name" content="${escapar(manifiesto.marca.nombre)}">\n` : ''

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${titulo}</title>
<meta property="og:type" content="website">
${sitio}<meta property="og:title" content="${titulo}">
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
        if (!archivoValido(archivo)) return error(400, 'Nombre de archivo no admitido.')
        const esLogo = LOGO_VALIDO.test(archivo)
        const tope = esLogo ? MAX_LOGO : MAX_FOTO

        const largo = Number(pedido.headers.get('Content-Length') ?? '0')
        if (largo > tope) return error(413, 'Ese archivo pesa demasiado.')

        const cuerpo = await pedido.arrayBuffer()
        if (cuerpo.byteLength > tope) return error(413, 'Ese archivo pesa demasiado.')
        if (cuerpo.byteLength === 0) return error(400, 'El archivo venía vacío.')

        const tipo = tipoDeImagen(cuerpo)
        if (!tipo) return error(400, 'Eso no es una imagen.')
        if (!esLogo && tipo !== 'image/jpeg') return error(400, 'Las fotos tienen que ser JPEG.')
        if (esLogo && !archivo.endsWith(`.${EXTENSION[tipo]}`)) {
          return error(400, 'El logo no es del tipo que dice su nombre.')
        }

        await env.TOURS.put(`t/${llave}/fotos/${archivo}`, cuerpo, {
          httpMetadata: {
            contentType: tipo,
            /* Las fotos de una llave solo cambian al volver a publicar, y el
               visor las pide con la ruta exacta, así que una copia vieja se
               retira sola en un día. Un año, como antes, dejaba al que republica
               con las fotos viejas en el teléfono del comprador. */
            cacheControl: 'public, max-age=86400',
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
        const manifiesto = saneado.valor

        /* Se comprueba que las fotos estén ARRIBA antes de encender el
           interruptor. Si una subida falló y nadie se dio cuenta, el cliente
           abriría la casa con un cuarto en negro; es mejor que falle aquí,
           mientras quien publica sigue mirando la pantalla. La variante de 2048
           y el logo se comprueban igual: si faltan, se quitan del manifiesto en
           vez de dejar una referencia rota, porque son opcionales. */
        let total = 0
        for (const escena of manifiesto.scenes) {
          const objeto = await env.TOURS.head(`t/${llave}/fotos/${escena.foto}`)
          if (!objeto) return error(409, `Falta subir la foto ${escena.foto}.`)
          total += objeto.size
          if (escena.miniatura) {
            const mini = await env.TOURS.head(`t/${llave}/fotos/${escena.miniatura}`)
            if (mini) total += mini.size
            else delete escena.miniatura
          }
          if (escena.foto2048) {
            const chica = await env.TOURS.head(`t/${llave}/fotos/${escena.foto2048}`)
            if (chica) total += chica.size
            else delete escena.foto2048
          }
        }
        if (manifiesto.marca?.logo) {
          const logo = await env.TOURS.head(`t/${llave}/fotos/${manifiesto.marca.logo}`)
          if (logo) total += logo.size
          else delete manifiesto.marca.logo
        }
        if (total > MAX_TOTAL) return error(413, 'El recorrido completo pesa demasiado.')

        await env.TOURS.put(`t/${llave}/tour.json`, JSON.stringify(manifiesto), {
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

    /* GET y también HEAD: el robot de una vista previa, un verificador de links
       o el propio visor pueden preguntar por el tamaño antes de bajar. Sin esto
       un HEAD daba 404 y parecía que la foto no existía. */
    if (partes[0] === 't' && (pedido.method === 'GET' || pedido.method === 'HEAD')) {
      const llave = partes[1]
      if (!llave || !LLAVE_VALIDA.test(llave)) return error(404, 'No existe.')

      const manifiesto = await env.TOURS.get(`t/${llave}/tour.json`)
      if (!manifiesto) return error(404, 'Este recorrido ya no está disponible.')

      // GET /t/<llave>            →  la página con la vista previa
      if (partes.length === 2) {
        const datos = (await manifiesto.json()) as ManifiestoPublico
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
      if (partes.length === 4 && partes[2] === 'fotos' && archivoValido(partes[3])) {
        const foto = await env.TOURS.get(`t/${llave}/fotos/${partes[3]}`)
        if (!foto) return error(404, 'Esa foto no está.')
        return new Response(pedido.method === 'HEAD' ? null : foto.body, {
          headers: {
            'Content-Type': foto.httpMetadata?.contentType ?? 'image/jpeg',
            // El tamaño se sabe: con él el navegador puede enseñar avance.
            'Content-Length': String(foto.size),
            'Cache-Control': 'public, max-age=86400',
            ...COMUNES,
          },
        })
      }

      return error(404, 'No existe.')
    }

    return error(404, 'No existe.')
  },
} satisfies ExportedHandler<Env>

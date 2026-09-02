import * as THREE from 'three'
import { DEG } from '../math'

/**
 * ============================================================================
 *  COSER LAS TOMAS EN UNA PANORÁMICA EQUIRECTANGULAR
 * ============================================================================
 *
 * Entra: una foto de la cámara + la orientación del teléfono al tomarla.
 * Sale: una equirectangular 2:1 que el visor puede usar tal cual.
 *
 * ── Se proyecta AL REVÉS, y esa es la decisión clave ───────────────────────
 *
 * Lo intuitivo sería deformar la foto y pegarla sobre el lienzo ("scatter"):
 * una malla de triángulos que se estira hasta su lugar. Funciona, pero trae
 * dos problemas feos: los triángulos que cruzan la costura de 360° se dibujan
 * atravesando toda la imagen, y cerca de los polos la malla se estira tanto
 * que aparecen picos.
 *
 * Aquí se hace al revés ("gather"): se recorre el LIENZO y, para cada píxel,
 * se calcula a qué dirección del mundo corresponde y si esa dirección cae
 * dentro de la foto. Cada píxel se resuelve solo:
 *
 *   píxel del lienzo → (yaw, pitch) → dirección → espacio de la cámara →
 *   → coordenada dentro de la foto → color
 *
 * Con eso no existe la costura (yaw y yaw−360 son la misma dirección y el seno
 * y el coseno no notan la diferencia) ni el problema de los polos (no hay malla
 * que estirar), y el resultado es exacto, sin error de interpolación.
 *
 * ── Cómo se mezclan las tomas ──────────────────────────────────────────────
 *
 * Cada toma se dibuja con alfa premultiplicado y desvanecido en los bordes,
 * encima de lo que ya había:
 *
 *   color = color_nuevo · a + color_viejo · (1 − a)
 *   alfa  = a + alfa_viejo · (1 − a)
 *
 * Al final se divide el color entre el alfa. Esa división es la que evita el
 * error clásico: sin ella, el borde desvanecido de la PRIMERA toma se mezcla
 * con el lienzo vacío (negro) y queda un halo oscuro alrededor de cada foto.
 *
 * En el centro de cada toma el alfa vale 1, así que la foto más reciente gana
 * entera y se ve nítida; solo se promedia en las orillas, que es donde el
 * promedio ayuda a esconder la unión.
 *
 * ── Exposición ─────────────────────────────────────────────────────────────
 *
 * El teléfono cambia la exposición al girar hacia una ventana. Se mide el
 * brillo medio de cada toma y se corrige con una ganancia acotada, para que la
 * panorámica no quede a bandas.
 */

/* ------------------------------------------------------------------ SHADERS */

const VERTEX = /* glsl */ `
  varying vec2 vNdc;
  void main() {
    // Las posiciones YA vienen en coordenadas de pantalla normalizadas: el
    // lienzo equirectangular ES el viewport, así que no hay matrices de cámara.
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  precision highp float;

  uniform sampler2D uFoto;
  uniform mat3 uMundoACamara;
  uniform vec2 uTanMitad;   // (tan(hfov/2), tan(vfov/2))
  uniform float uDifuminado; // fracción del borde que se desvanece (0.02 … 0.4)
  uniform float uGanancia;   // corrección de exposición

  varying vec2 vNdc;

  const float PI = 3.141592653589793;

  void main() {
    // 1. Píxel del lienzo → dirección del mundo.
    //    x ∈ [-1,1] recorre yaw de -180° a 180°; y ∈ [-1,1] recorre pitch de -90° a 90°.
    float yaw = vNdc.x * PI;
    float pitch = vNdc.y * PI * 0.5;
    float cp = cos(pitch);
    vec3 dir = vec3(cp * sin(yaw), sin(pitch), -cp * cos(yaw));

    // 2. A espacio de la cámara. La cámara mira hacia -Z.
    vec3 d = uMundoACamara * dir;
    if (d.z > -0.0001) discard;              // queda atrás: no es parte de la foto

    // 3. Proyección gnomónica: la misma que hace una lente.
    vec2 plano = vec2(d.x / -d.z, d.y / -d.z) / uTanMitad;
    if (abs(plano.x) > 1.0 || abs(plano.y) > 1.0) discard;

    vec2 uv = plano * 0.5 + 0.5;

    // 4. Peso: 1 en el centro, 0 en el borde exacto.
    vec2 orilla = min(uv, 1.0 - uv) / max(uDifuminado, 0.001);
    float a = clamp(min(orilla.x, orilla.y), 0.0, 1.0);
    a = a * a * (3.0 - 2.0 * a);             // smoothstep a mano

    vec3 color = texture2D(uFoto, uv).rgb * uGanancia;
    gl_FragColor = vec4(color * a, a);       // alfa premultiplicado
  }
`

/** Divide el color entre el alfa acumulado y deja la panorámica lista para ver. */
const FRAGMENT_NORMALIZAR = /* glsl */ `
  precision highp float;
  uniform sampler2D uAcumulado;
  uniform vec3 uVacio;
  varying vec2 vNdc;
  void main() {
    vec2 uv = vNdc * 0.5 + 0.5;
    vec4 acc = texture2D(uAcumulado, uv);
    // Debajo de este alfa se considera "no fotografiado": pintarlo sería
    // amplificar ruido hasta convertirlo en manchas de colores.
    if (acc.a < 0.02) {
      gl_FragColor = vec4(uVacio, 1.0);
      return;
    }
    gl_FragColor = vec4(acc.rgb / acc.a, 1.0);
  }
`

/* -------------------------------------------------------------------- TIPOS */

export type StitcherOptions = {
  /** Ancho del lienzo. El alto siempre es la mitad (equirectangular 2:1). */
  width?: number
  /** Fracción del borde de cada foto que se desvanece. */
  difuminado?: number
  /** Tamaño del canvas de vista previa que se puede mostrar en pantalla. */
  preview?: { width: number; height: number }
  /** Color del lienzo sin fotografiar. */
  colorVacio?: THREE.ColorRepresentation
}

export type Toma = {
  /**
   * La foto, SIEMPRE como canvas o <img>.
   *
   * A propósito no se acepta un ImageBitmap: al subirlo a la GPU, el volteo
   * vertical (`UNPACK_FLIP_Y_WEBGL`) no se aplica igual en todos los
   * navegadores, y el resultado es una panorámica de cabeza en unos teléfonos
   * sí y en otros no. Con un canvas el comportamiento es el mismo en todos.
   */
  fuente: HTMLCanvasElement | HTMLImageElement
  /** Orientación de la cámara al tomarla, en el mundo del visor. */
  orientacion: THREE.Quaternion
  /** Campo de visión horizontal y vertical de la foto, en grados. */
  hfov: number
  vfov: number
  /** Brillo medio (0…1) para igualar la exposición. Opcional. */
  brillo?: number
}

/* --------------------------------------------------------------- HERRAMIENTA */

/** Holgura de la caja de recorte, en grados. Ver el comentario de `caja`. */
const MARGEN_PITCH = 4
const MARGEN_YAW = 2

/** Ancho de la miniatura con la que se mide la cobertura. Ver `cobertura`. */
const MUESTRAS_COBERTURA = 96

/** Tamaño de lienzo razonable según lo que aguante el dispositivo. */
export function anchoRecomendado(renderer: THREE.WebGLRenderer): number {
  const maxTextura = renderer.capabilities.maxTextureSize
  const memoria = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  if (maxTextura >= 4096 && memoria >= 4) return 4096
  if (maxTextura >= 2048) return 2048
  return 1024
}

export class PanoramaStitcher {
  readonly width: number
  readonly height: number
  /** Canvas con la vista previa en vivo. Se puede meter directo al DOM. */
  readonly canvas: HTMLCanvasElement

  private renderer: THREE.WebGLRenderer
  private acumulado: THREE.WebGLRenderTarget
  private escena = new THREE.Scene()
  private escenaNormalizar = new THREE.Scene()
  private camara = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private malla: THREE.Mesh
  private material: THREE.ShaderMaterial
  private materialNormalizar: THREE.ShaderMaterial
  private posiciones: THREE.BufferAttribute

  private matriz = new THREE.Matrix4()
  private matriz3 = new THREE.Matrix3()
  private direccion = new THREE.Vector3()

  /** Brillo medio de la primera toma: la referencia para igualar las demás. */
  private brilloReferencia: number | null = null
  private tomas = 0

  /* Cobertura: el objetivo y el material se crean UNA vez y se reutilizan.
     Antes se creaban y se tiraban en cada llamada, y como `cobertura()` se
     dispara con cada toma, eso significaba compilar y enlazar un programa de
     WebGL por foto. Compilar un shader no es gratis en un celular: bloquea el
     hilo mientras el driver traduce el GLSL. */
  private objetivoCobertura: THREE.WebGLRenderTarget
  private materialCobertura: THREE.ShaderMaterial

  /* El navegador puede quitarle a la pestaña el contexto de la tarjeta gráfica
     cuando anda escaso de memoria, y en los teléfonos pasa de verdad: basta con
     irse a otra app un rato en mitad de una captura. Cuando eso ocurre, todo
     lo acumulado en la GPU se pierde: el objetivo se queda en blanco y las
     llamadas de dibujo no hacen nada, sin lanzar ningún error. */
  private contextoPerdido = false

  /** Se avisa hacia arriba para que la interfaz pueda ofrecer volver a coser. */
  onContextoPerdido: (() => void) | null = null

  constructor(options: StitcherOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })

    // CRÍTICO: por defecto three borra el destino antes de cada render, y aquí
    // cada toma se dibuja ENCIMA de las anteriores. Con el borrado automático
    // encendido, la panorámica terminaría siendo solo la última foto.
    this.renderer.autoClear = false

    /* Nunca por encima de lo que la GPU puede texturizar: pedir un render
       target más grande que MAX_TEXTURE_SIZE no lanza nada útil, deja un
       objetivo incompleto y la panorámica sale en negro. */
    const pedido = options.width ?? anchoRecomendado(this.renderer)
    this.width = Math.min(pedido, this.renderer.capabilities.maxTextureSize)
    this.height = this.width / 2

    const preview = options.preview ?? { width: 640, height: 320 }
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(preview.width, preview.height, false)
    this.canvas = this.renderer.domElement

    /* three ya llama a preventDefault en su propio manejador, que es lo que
       permite que el contexto se pueda restaurar después. Aquí solo se levanta
       la bandera: restaurar el contexto devuelve un lienzo VACÍO, no la
       panorámica que había, así que la única recuperación honesta es volver a
       pegar las tomas una por una desde los JPEG que siguen en memoria. */
    this.canvas.addEventListener('webglcontextlost', () => {
      this.contextoPerdido = true
      this.onContextoPerdido?.()
    })

    this.acumulado = new THREE.WebGLRenderTarget(this.width, this.height, {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      // Sin conversión de espacio de color: lo que entra de la cámara sale
      // idéntico al JPEG. Los shaders son crudos y no incluyen la conversión.
      colorSpace: THREE.NoColorSpace,
    })

    /* Un cuadrilátero cuyas posiciones se reescriben en cada toma para cubrir
       solo la zona del lienzo donde esa foto puede caer. */
    const geometria = new THREE.BufferGeometry()
    this.posiciones = new THREE.BufferAttribute(new Float32Array(12), 3)
    this.posiciones.setUsage(THREE.DynamicDrawUsage)
    geometria.setAttribute('position', this.posiciones)
    geometria.setIndex([0, 1, 2, 0, 2, 3])

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uFoto: { value: null },
        uMundoACamara: { value: new THREE.Matrix3() },
        uTanMitad: { value: new THREE.Vector2(1, 1) },
        uDifuminado: { value: options.difuminado ?? 0.14 },
        uGanancia: { value: 1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // "Encima", con alfa premultiplicado: el shader ya multiplicó el color.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    })

    this.malla = new THREE.Mesh(geometria, this.material)
    this.malla.frustumCulled = false
    this.escena.add(this.malla)

    const vacio = new THREE.Color(options.colorVacio ?? 0x11161f)
    this.materialNormalizar = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT_NORMALIZAR,
      uniforms: {
        uAcumulado: { value: this.acumulado.texture },
        uVacio: { value: new THREE.Vector3(vacio.r, vacio.g, vacio.b) },
      },
      depthTest: false,
      depthWrite: false,
    })

    const cuadroCompleto = new THREE.BufferGeometry()
    cuadroCompleto.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
        3,
      ),
    )
    cuadroCompleto.setIndex([0, 1, 2, 0, 2, 3])
    const mallaNormalizar = new THREE.Mesh(cuadroCompleto, this.materialNormalizar)
    mallaNormalizar.frustumCulled = false
    this.escenaNormalizar.add(mallaNormalizar)

    this.objetivoCobertura = new THREE.WebGLRenderTarget(
      MUESTRAS_COBERTURA,
      Math.round(MUESTRAS_COBERTURA / 2),
      { depthBuffer: false, stencilBuffer: false, colorSpace: THREE.NoColorSpace },
    )
    this.materialCobertura = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uAcumulado;
        varying vec2 vNdc;
        void main() { gl_FragColor = texture2D(uAcumulado, vNdc * 0.5 + 0.5); }
      `,
      uniforms: { uAcumulado: { value: this.acumulado.texture } },
      depthTest: false,
      depthWrite: false,
    })

    this.limpiar()
  }

  /** Deja el lienzo vacío (alfa 0 en todos lados). */
  limpiar() {
    const anterior = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.acumulado)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.clear(true, false, false)
    this.renderer.setRenderTarget(anterior)
    this.brilloReferencia = null
    this.tomas = 0
    this.dibujarPreview()
  }

  get totalTomas() {
    return this.tomas
  }

  /** True si la tarjeta gráfica soltó el contexto y este costurero ya no sirve. */
  get perdido() {
    return this.contextoPerdido
  }

  /**
   * Pega una toma en el lienzo.
   *
   * Se dibuja solo sobre el rectángulo del lienzo donde la foto PUEDE caer.
   * Sin ese recorte habría que evaluar los 8 millones de píxeles del lienzo por
   * cada foto, y en un celular eso se siente.
   */
  agregar(toma: Toma) {
    // Sin contexto, `render` no lanza nada: simplemente no dibuja. Seguir
    // sumando tomas solo serviría para creer que la panorámica va avanzando.
    if (this.contextoPerdido) return

    const textura = new THREE.Texture(toma.fuente)
    textura.colorSpace = THREE.NoColorSpace

    /* La foto SIEMPRE se ve más chica en el lienzo de lo que es: al pegarla en
       la equirectangular se reduce 1.9 veces en el centro y 3.1 veces en la
       esquina, que es justo la zona donde se traslapa con la vecina. Con un
       filtro lineal a secas, reducir así es tomar uno de cada tres píxeles y
       tirar los otros dos: aparece ese hormigueo de bordes duros en las
       costuras. Con mipmaps la GPU promedia el bloque entero, que es lo que
       corresponde, y el anisotrópico evita que se emborrone de más en la
       dirección en la que no hace falta.
       El precio es generar la pirámide de cada foto —una pasada extra sobre
       1600×1200 por toma, y se paga otra vez al recoser— pero lo hace el
       driver en la GPU, no el hilo principal. */
    textura.minFilter = THREE.LinearMipmapLinearFilter
    textura.magFilter = THREE.LinearFilter
    textura.wrapS = THREE.ClampToEdgeWrapping
    textura.wrapT = THREE.ClampToEdgeWrapping
    textura.generateMipmaps = true
    textura.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    textura.flipY = true
    textura.needsUpdate = true

    const uniforms = this.material.uniforms
    uniforms.uFoto.value = textura
    uniforms.uTanMitad.value.set(
      Math.tan((toma.hfov * DEG) / 2),
      Math.tan((toma.vfov * DEG) / 2),
    )

    // Mundo → cámara es la inversa de la orientación del teléfono.
    this.matriz.makeRotationFromQuaternion(toma.orientacion).invert()
    this.matriz3.setFromMatrix4(this.matriz)
    uniforms.uMundoACamara.value.copy(this.matriz3)

    uniforms.uGanancia.value = this.ganancia(toma.brillo)

    const caja = this.caja(toma)
    const anterior = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.acumulado)

    // Si la zona cruza la costura de 360°, se dibuja también la copia corrida:
    // el shader saca el yaw de la posición, y yaw±360 es la misma dirección.
    for (const desplazamiento of caja.copias) {
      this.escribirCuadro(caja.x0 + desplazamiento, caja.x1 + desplazamiento, caja.y0, caja.y1)
      this.renderer.render(this.escena, this.camara)
    }

    this.renderer.setRenderTarget(anterior)
    textura.dispose()
    this.tomas++
    this.dibujarPreview()
  }

  /** Ganancia acotada para igualar el brillo con la primera toma. */
  private ganancia(brillo?: number): number {
    if (brillo === undefined || brillo <= 0.001) return 1
    if (this.brilloReferencia === null) {
      this.brilloReferencia = brillo
      return 1
    }
    const factor = this.brilloReferencia / brillo
    // Sin tope, una foto contra la ventana pediría multiplicar por 5 y quemaría
    // el resto de la panorámica.
    return Math.min(1.5, Math.max(0.66, factor))
  }

  private escribirCuadro(x0: number, x1: number, y0: number, y1: number) {
    const p = this.posiciones.array as Float32Array
    p[0] = x0; p[1] = y0; p[2] = 0
    p[3] = x1; p[4] = y0; p[5] = 0
    p[6] = x1; p[7] = y1; p[8] = 0
    p[9] = x0; p[10] = y1; p[11] = 0
    this.posiciones.needsUpdate = true
  }

  /**
   * Rectángulo del lienzo (en coordenadas normalizadas) que la foto puede tocar.
   *
   * Se muestrea el borde del rectángulo de la foto porque las esquinas NO son
   * el extremo: una foto inclinada alcanza su pitch máximo a media orilla.
   * Si la foto se traga un polo, el rango de yaw pasa a ser el círculo completo.
   *
   * El muestreo es aproximado —el máximo real cae entre dos muestras— así que
   * lleva margen. Medido barriendo miles de combinaciones de inclinación y
   * ladeo, el error del muestreo llega a 3° de pitch en el peor caso (una foto
   * muy abierta, muy inclinada y ladeada); con 4° de margen no se sale ninguna.
   * Quedarse corto significa recortar una tira de la foto sin avisar.
   */
  private caja(toma: Toma) {
    const tanH = Math.tan((toma.hfov * DEG) / 2)
    const tanV = Math.tan((toma.vfov * DEG) / 2)

    let pitchMin = 90
    let pitchMax = -90
    let yawMin = Infinity
    let yawMax = -Infinity
    let yawCentro = 0

    const proyectar = (sx: number, sy: number) => {
      this.direccion.set(sx * tanH, sy * tanV, -1).applyQuaternion(toma.orientacion).normalize()
      const pitch = Math.asin(Math.max(-1, Math.min(1, this.direccion.y))) / DEG
      const yaw = Math.atan2(this.direccion.x, -this.direccion.z) / DEG
      return { yaw, pitch }
    }

    const centro = proyectar(0, 0)
    yawCentro = centro.yaw
    pitchMin = pitchMax = centro.pitch
    yawMin = yawMax = 0

    const PASOS = 24
    for (let i = 0; i <= PASOS; i++) {
      const t = (i / PASOS) * 2 - 1
      for (const [sx, sy] of [[t, -1], [t, 1], [-1, t], [1, t]] as const) {
        const { yaw, pitch } = proyectar(sx, sy)
        pitchMin = Math.min(pitchMin, pitch)
        pitchMax = Math.max(pitchMax, pitch)
        // Se desenrolla contra el centro para que una foto a caballo de la
        // costura no reporte un rango de casi 360°.
        let delta = yaw - yawCentro
        while (delta > 180) delta -= 360
        while (delta < -180) delta += 360
        yawMin = Math.min(yawMin, delta)
        yawMax = Math.max(yawMax, delta)
      }
    }

    // ¿La foto contiene un polo? Ahí el yaw deja de estar acotado.
    const contienePolo = (signo: 1 | -1) => {
      this.direccion.set(0, signo, 0).applyQuaternion(
        this.polar.copy(toma.orientacion).invert(),
      )
      if (this.direccion.z > -1e-6) return false
      return (
        Math.abs(this.direccion.x / -this.direccion.z) <= tanH &&
        Math.abs(this.direccion.y / -this.direccion.z) <= tanV
      )
    }

    let x0: number
    let x1: number
    if (contienePolo(1) || contienePolo(-1)) {
      if (contienePolo(1)) pitchMax = 90
      if (contienePolo(-1)) pitchMin = -90
      x0 = -1
      x1 = 1
    } else {
      x0 = (yawCentro + yawMin - MARGEN_YAW) / 180
      x1 = (yawCentro + yawMax + MARGEN_YAW) / 180
    }

    const y0 = Math.max(-1, (pitchMin - MARGEN_PITCH) / 90)
    const y1 = Math.min(1, (pitchMax + MARGEN_PITCH) / 90)

    // La parte que se sale por un lado del lienzo reaparece por el otro.
    const copias = [0]
    if (x0 < -1) copias.push(2)
    if (x1 > 1) copias.push(-2)

    return { x0, x1, y0, y1, copias }
  }

  private polar = new THREE.Quaternion()

  /** Repinta el canvas de vista previa con la panorámica normalizada. */
  dibujarPreview() {
    this.renderer.setRenderTarget(null)
    this.renderer.render(this.escenaNormalizar, this.camara)
  }

  /**
   * Cobertura de la esfera, de 0 a 1.
   *
   * Se mide sobre una versión reducida y PESADA POR EL COSENO DEL PITCH: en una
   * equirectangular las filas de arriba y abajo son estiramientos del polo, y
   * contarlas igual que el ecuador diría "80 % listo" cuando falta media pared.
   */
  cobertura(muestras = MUESTRAS_COBERTURA): number {
    // Sin contexto no hay nada que leer y el objetivo saldría en cero, o sea
    // "0 % cubierto", que es una respuesta creíble y falsa. Mejor decirlo.
    if (this.contextoPerdido) return 0

    const alto = Math.max(2, Math.round(muestras / 2))
    /* El objetivo se creó en el constructor con el tamaño de siempre. Si esta
       llamada pide otro, hay que redimensionarlo ANTES de dibujar: si no, se
       leerían `muestras × alto` píxeles de un objetivo que sigue teniendo el
       tamaño de la primera llamada. `setSize` no hace nada si el tamaño ya
       coincide, que es el caso normal. */
    this.objetivoCobertura.setSize(muestras, alto)

    // Se copia el acumulado tal cual (sin normalizar) para conservar el alfa.
    const anterior = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.objetivoCobertura)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.clear(true, false, false)

    const malla = this.escenaNormalizar.children[0] as THREE.Mesh
    const materialOriginal = malla.material
    malla.material = this.materialCobertura
    this.renderer.render(this.escenaNormalizar, this.camara)
    malla.material = materialOriginal

    const pixeles = new Uint8Array(muestras * alto * 4)
    this.renderer.readRenderTargetPixels(this.objetivoCobertura, 0, 0, muestras, alto, pixeles)
    this.renderer.setRenderTarget(anterior)

    let cubierto = 0
    let total = 0
    for (let fila = 0; fila < alto; fila++) {
      // Centro de la fila → pitch → peso.
      const pitch = ((fila + 0.5) / alto) * 180 - 90
      const peso = Math.cos(pitch * DEG)
      for (let columna = 0; columna < muestras; columna++) {
        const alfa = pixeles[(fila * muestras + columna) * 4 + 3]
        total += peso
        if (alfa > 96) cubierto += peso
      }
    }
    return total > 0 ? cubierto / total : 0
  }

  /**
   * Exporta la panorámica terminada.
   *
   * La normalización (dividir color entre alfa) se hace aquí en JavaScript y no
   * en un shader, y se hace EN SITIO sobre el mismo bloque de memoria que se
   * leyó de la tarjeta gráfica. Eso importa: a 4096×2048 ese bloque son 33.5 MB
   * y la versión anterior pedía un segundo bloque igual para el `ImageData`,
   * justo en el momento en que además hay que armar el JPEG. Eran 67 MB de pico
   * y una copia entera de más, y en un celular es exactamente el momento en que
   * la pestaña se recarga sola.
   *
   * El truco es que `ImageData` se puede construir SOBRE un `Uint8ClampedArray`
   * que ya existe, sin copiarlo. Por eso el volteo vertical —la fila 0 del
   * framebuffer es la de abajo y la de la imagen es la de arriba— se hace
   * intercambiando filas de a pares en el mismo arreglo, con un renglón de
   * ida y vuelta de 16 KB como único apoyo.
   */
  async exportar(calidad = 0.86): Promise<Blob> {
    if (this.contextoPerdido) {
      throw new Error(
        'El teléfono liberó la memoria de la tarjeta gráfica. Hay que volver a unir las fotos.',
      )
    }

    const { width, height } = this
    const pixeles = new Uint8ClampedArray(width * height * 4)
    this.renderer.readRenderTargetPixels(this.acumulado, 0, 0, width, height, pixeles)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No se pudo preparar el lienzo de la panorámica.')

    const vacio = this.materialNormalizar.uniforms.uVacio.value as THREE.Vector3
    const vr = Math.round(vacio.x * 255)
    const vg = Math.round(vacio.y * 255)
    const vb = Math.round(vacio.z * 255)

    const bytesPorFila = width * 4
    // El arreglo es "clamped": al escribir, el navegador ya redondea y recorta
    // a 0…255 por su cuenta, así que la división por alfa no necesita tope.
    const normalizarFila = (inicio: number) => {
      for (let columna = 0; columna < width; columna++) {
        const i = inicio + columna * 4
        const alfa = pixeles[i + 3]
        if (alfa < 5) {
          pixeles[i] = vr
          pixeles[i + 1] = vg
          pixeles[i + 2] = vb
        } else {
          const escala = 255 / alfa
          pixeles[i] *= escala
          pixeles[i + 1] *= escala
          pixeles[i + 2] *= escala
        }
        pixeles[i + 3] = 255
      }
    }

    const renglon = new Uint8ClampedArray(bytesPorFila)
    const mitad = Math.floor(height / 2)
    for (let fila = 0; fila < mitad; fila++) {
      const arriba = fila * bytesPorFila
      const abajo = (height - 1 - fila) * bytesPorFila
      normalizarFila(arriba)
      normalizarFila(abajo)
      renglon.set(pixeles.subarray(arriba, arriba + bytesPorFila))
      pixeles.copyWithin(arriba, abajo, abajo + bytesPorFila)
      pixeles.set(renglon, abajo)
    }
    // Con alto impar la fila del medio se queda donde está, pero igual hay que
    // normalizarla: el bucle de arriba nunca la toca.
    if (height % 2 === 1) normalizarFila(mitad * bytesPorFila)

    ctx.putImageData(new ImageData(pixeles, width, height), 0, 0)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', calidad),
    )
    canvas.width = 0
    canvas.height = 0
    if (!blob) throw new Error('El navegador no pudo guardar la panorámica.')
    return blob
  }

  dispose() {
    this.acumulado.dispose()
    this.objetivoCobertura.dispose()
    this.materialCobertura.dispose()
    this.material.dispose()
    this.materialNormalizar.dispose()
    this.malla.geometry.dispose()
    this.renderer.dispose()
    // Sin esto el contexto WebGL puede quedar vivo hasta que el recolector pase,
    // y los celulares aguantan pocos contextos a la vez.
    this.renderer.forceContextLoss()
  }
}

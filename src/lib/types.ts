/**
 * Modelo de datos del recorrido.
 *
 * Convención de ángulos usada en TODO el proyecto (grados, no radianes):
 *   yaw   →  rotación horizontal. 0 = frente inicial de la escena.
 *            Positivo = girar a la DERECHA.
 *   pitch →  inclinación vertical. 0 = horizonte.
 *            Positivo = mirar HACIA ARRIBA. Se limita a ±85° para no llegar al polo.
 */

export type Hotspot = {
  id: string
  /** Dirección del marcador dentro de la esfera. */
  yaw: number
  pitch: number
  /** Texto corto que se muestra en la burbuja. */
  label: string
} & (
  | {
      /** Salta a otra escena del recorrido. */
      kind: 'link'
      /** id de la escena destino. */
      to: string
      /** Hacia dónde queda viendo la cámara al llegar. Default: initialYaw de la escena. */
      arriveYaw?: number
    }
  | {
      /** Solo informativo: abre un panel, no navega. */
      kind: 'info'
      body?: string
    }
)

/**
 * ============================================================================
 *  EL PLANO DE LA CASA
 * ============================================================================
 *
 * Dónde queda cada habitación sobre la planta arquitectónica, y hacia dónde
 * mira el frente de su foto. Las coordenadas van NORMALIZADAS a [0, 1] y no en
 * píxeles, a propósito: así se puede cambiar el plano por uno de otra
 * resolución (un escaneo mejor) sin recolocar nada.
 *
 * `giro` son los grados, en el sentido del reloj desde "arriba" del plano, a
 * los que mira el yaw 0 de la panorámica. Con él el minimapa dibuja el cono de
 * hacia dónde se está mirando; sin él dibuja solo el punto, que es la verdad
 * cuando no se sabe. Ver `src/lib/planta.ts`, incluido cómo el `rumbo` de las
 * fotos capturadas orienta las demás a partir de una.
 */
export type PosicionEnPlano = { x: number; y: number; giro?: number }

/** El plano ya resuelto a una URL, para el visor. En `StoredTour` es una llave de Blob. */
export type Plano = { imagen: string; ancho: number; alto: number }

export type TourScene = {
  id: string
  name: string
  /** Ruta a la equirectangular 2:1 (relativa a /public). */
  image: string
  /** Miniatura opcional para la barra inferior. */
  thumbnail?: string
  /** Yaw al entrar por primera vez a la escena. Default 0. */
  initialYaw?: number
  /**
   * Rumbo real del frente de la panorámica (0 = norte). Ausente cuando la foto
   * no trae dato de brújula, y entonces la brújula del visor no dice "N".
   * Ver `src/lib/rumbo.ts`.
   */
  rumbo?: number
  /** Corrección de nivel al ver, en grados. Ver `src/lib/nivel.ts`. */
  nivel?: { tiltX: number; tiltZ: number }
  /** Dónde está esta habitación en el plano de la casa, si el recorrido trae plano. */
  plano?: PosicionEnPlano
  hotspots: Hotspot[]
}

/**
 * ============================================================================
 *  LA MARCA DE QUIEN ENSEÑA LA CASA
 * ============================================================================
 *
 * Los colores del visor son tokens de Tailwind v4 declarados en `src/index.css`,
 * y —comprobado en el CSS ya compilado— las utilidades los consumen por
 * referencia: `.bg-brand-500` sale como `background-color:var(--color-brand-500)`.
 * El hex solo aparece en la declaración de `:root`.
 *
 * Eso hace que vestir el visor con la identidad de otra inmobiliaria NO necesite
 * recompilar nada: basta reasignar las propiedades. Es lo que hace
 * `src/lib/marca.ts`. Las custom properties existen desde Safari 9.1, muy por
 * debajo del piso del proyecto.
 *
 * Todo es opcional a propósito: sin marca, el visor se ve exactamente como hoy.
 */
export type Marca = {
  /** Para el encabezado y el nombre del archivo. */
  nombre?: string
  /**
   * Hexadecimal, NUNCA `oklch()` ni `color-mix()`: los dos son de Safari 15.4 y
   * 16.2, y un color que el navegador no entiende no es un color feo — es una
   * declaración inválida, y el fondo simplemente no se pinta.
   */
  colores?: {
    brand300?: string
    brand400?: string
    brand500?: string
    brand600?: string
    ink50?: string
    ink200?: string
    ink700?: string
    ink900?: string
  }
  /** El vidrio del HUD. Una inmobiliaria puede quererlo claro. */
  hudFondo?: string
  /**
   * La tinta del texto que va ENCIMA del vidrio, y su tono secundario. Sin
   * ellas el HUD sigue a `ink50`/`ink200`, que también colorean la página: un
   * vidrio claro necesita las suyas, oscuras, sin oscurecer la app entera.
   */
  hudTinta?: string
  hudTintaSuave?: string
  /** Fondo de la app detrás del canvas. */
  fondoApp?: string
  /** Una de las pilas de `TIPOGRAFIAS`, no una URL: ver marca.ts. */
  tipografia?: 'sistema' | 'serif' | 'geometrica'
  /** URL del logo ya resuelta (en `StoredTour` es `logoId`, una llave de Blob). */
  logo?: string
}

/**
 * ============================================================================
 *  LOS DATOS DE LA CASA
 * ============================================================================
 *
 * Lo que se le muestra a un comprador ANTES de entrar al recorrido. Es la
 * pantalla que decide si entra o cierra la pestaña.
 *
 * `precio` es **string y no número**, y es una decisión, no pereza: en los
 * listados reales de México aparece "Desde $1.9M", "Precio a consultar", y
 * mezclados USD y MXN. Un número obligaría a meter una decisión de moneda y de
 * locale dentro del visor, y perdería el "Desde" — que es información, no
 * adorno. Lo mismo con `superficie`: la gente escribe "120 m² de terreno".
 */
export type Ficha = {
  precio?: string
  superficie?: string
  recamaras?: number
  banos?: number
  direccion?: string
  descripcion?: string
  agente?: {
    nombre?: string
    telefono?: string
    /** Solo dígitos con lada país, p. ej. "5213312345678". */
    whatsapp?: string
    correo?: string
  }
}

export type Tour = {
  title: string
  subtitle?: string
  startSceneId: string
  scenes: TourScene[]
  marca?: Marca
  ficha?: Ficha
  /** Modo kiosco: el recorrido gira solo hasta que alguien lo toca. Apagado si falta. */
  autogiro?: boolean
  /** La planta arquitectónica, para el minimapa. Ver `src/lib/planta.ts`. */
  plano?: Plano
}

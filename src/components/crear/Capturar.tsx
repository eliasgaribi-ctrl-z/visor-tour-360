/* oxlint-disable react/set-state-in-effect, react/immutability -- Los efectos
   sincronizan con la cámara y los sensores, que son sistemas externos, y las
   estructuras mutables son el canal sin renders hacia el dibujo por cuadro
   (misma idea que src/lib/tourEngine.ts). */
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import type { Ruta } from '../../lib/useHashRoute'
import type { StoredTour } from '../../lib/store/types'
import {
  createScene,
  getTour,
  guardarEscenaConFoto,
  reemplazarFoto,
} from '../../lib/store/tours'
import { slugId, newId } from '../../lib/store/ids'
import { DEG, wrap180 } from '../../lib/math'

import {
  abrirCamara,
  cerrarCamara,
  contextoSeguro,
  elegirLentePrincipal,
  esperarVideo,
  fijarExposicion,
  listarCamaras,
  vigilarCamara,
  CameraError,
  type CameraSession,
} from '../../lib/capture/camera'
import {
  OrientationTracker,
  needsOrientationPermission,
  requestOrientationPermission,
  screenAngle,
  type OrientationState,
} from '../../lib/capture/orientation'
import {
  FOV_LADO_LARGO,
  anchoUtilizable,
  brilloDe,
  capturarFotograma,
  estimarFovConGiro,
  fovDe,
  grisesReducidos,
  ladoLargoDesdeHorizontal,
  mediana,
  miniatura,
  soltarLienzo,
} from '../../lib/capture/frames'
import { planDeCaptura, puntoMasCercano, type PuntoGuia } from '../../lib/capture/plan'
import { mantenerPantallaEncendida } from '../../lib/capture/pantalla'
import { PanoramaStitcher } from '../../lib/capture/stitcher'
import { detectWebGL } from '../tour/Escena360'

import { Aviso, Boton, Campo, Cargando, Hoja, Pantalla } from './ui'
import { GuiaCaptura } from './GuiaCaptura'

/** A cuántos grados del punto guía se considera que ya estás apuntando ahí. */
const TOLERANCIA_DEG = 11
/**
 * Debajo de esta velocidad angular se considera que el teléfono está quieto.
 *
 * Iba en 14 °/s, y era demasiado permisivo: a esa velocidad la cámara de un
 * celular todavía arrastra la imagen. Con el tiempo de exposición de un cuarto
 * con luz de casa —de 1/30 a 1/15 s— catorce grados por segundo son medio grado
 * de barrido dentro de una sola foto, y eso ya se ve como una toma movida.
 */
const QUIETO_DEG_S = 6
/**
 * Cuánto hay que sostener la mira quieta sobre el punto antes de disparar.
 *
 * Antes no había ninguna espera: bastaba con que en UN cuadro el punto quedara
 * dentro de la tolerancia y la velocidad bajara del umbral. Girando a pulso eso
 * pasa mientras el teléfono todavía va pasando por encima del punto —el
 * giroscopio marca un valle de velocidad en cuanto la mano frena un poco— así
 * que la foto salía movida y la costura la pegaba borrosa.
 *
 * Sostener la mira dos segundos arregla las dos mitades del problema: la mano
 * termina de asentarse, y de paso la cámara alcanza a cerrar su enfoque y su
 * exposición, que es lo que de verdad tarda dentro de una casa.
 */
const ASENTAR_MS = 2000
/** Descanso mínimo entre disparos. */
const ESPERA_MS = 450
/** Tamaño de las miniaturas en gris con las que se calibra el campo de visión. */
const GRIS = { ancho: 96, alto: 72 }
/** Cada cuánto se toma una miniatura del video mientras el usuario gira. */
const MUESTREO_MS = 140

type Toma = {
  puntoId: string | null
  /** JPEG de la toma. Se guarda para poder deshacer y para recoser al final. */
  blob: Blob
  orientacion: THREE.Quaternion
  brillo: number
  yaw: number
  pitch: number
}

/** Miniatura en gris del video, con la dirección a la que apuntaba. */
type Muestra = { grises: Float32Array; yaw: number; pitch: number }

type Fase =
  | { nombre: 'permisos' }
  | { nombre: 'abriendo' }
  | { nombre: 'capturando' }
  | { nombre: 'procesando'; mensaje: string }
  | { nombre: 'nombrar'; foto: Blob; mini: Blob; cobertura: number }
  | { nombre: 'error'; mensaje: string; consejo?: string }

export type CapturarProps = {
  tourId: string
  /** Si viene, la panorámica nueva REEMPLAZA la de esa habitación y se le
      conservan el nombre, los puntos y la vista de entrada. */
  sceneId?: string
  ir: (ruta: Ruta) => void
}

const Y = new THREE.Vector3(0, 1, 0)

export function Capturar({ tourId, sceneId, ir }: CapturarProps) {
  const [fase, setFase] = useState<Fase>({ nombre: 'permisos' })
  const [tour, setTour] = useState<StoredTour | null>(null)
  const [alcance, setAlcance] = useState<'esfera' | 'vuelta'>('esfera')
  const [puntos, setPuntos] = useState<PuntoGuia[]>([])
  const [tomadas, setTomadas] = useState(0)
  const [cobertura, setCobertura] = useState(0)
  const [estadoSensor, setEstadoSensor] = useState<OrientationState>('inactivo')
  const [aviso, setAviso] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [fovPantalla, setFovPantalla] = useState(60)
  const [caja, setCaja] = useState({ ancho: 1, alto: 1 })
  const [cubiertos, setCubiertos] = useState(0)
  const [manual, setManual] = useState(false)
  const [pasoManual, setPasoManual] = useState(0)
  const [fantasma, setFantasma] = useState<string | null>(null)
  /** Ángulo de pantalla con el que se calculó el plan. Girar lo invalida. */
  const [anguloInicial, setAnguloInicial] = useState(0)
  const [girado, setGirado] = useState(false)
  /** El permiso de sensores se negó a propósito (distinto de "no hay"). */
  const [permisoNegado, setPermisoNegado] = useState(false)

  /* El seguidor se crea UNA sola vez y vive lo que viva la pantalla: si se
     recreara en cada render, el dibujo por cuadro leería un objeto distinto del
     que está recibiendo los eventos del sensor. */
  const [seguidor] = useState(() => new OrientationTracker())

  const video = useRef<HTMLVideoElement>(null)
  const contenedor = useRef<HTMLDivElement>(null)
  const previa = useRef<HTMLDivElement>(null)

  const sesion = useRef<CameraSession | null>(null)
  const stitcher = useRef<PanoramaStitcher | null>(null)
  const tomas = useRef<Toma[]>([])
  const hechos = useRef(new Set<string>())
  const objetivo = useRef<string | null>(null)
  /** Desde cuándo la mira lleva quieta sobre el objetivo. 0 = todavía no. */
  const asentadoDesde = useRef(0)
  /** 0…1 de la espera de asentamiento. Lo lee GuiaCaptura en cada cuadro. */
  const asentado = useRef(0)
  const planRef = useRef<PuntoGuia[]>([])
  const baseYaw = useRef(0)
  const ultimaToma = useRef(0)
  const fovLargo = useRef(FOV_LADO_LARGO)
  const estimaciones = useRef<number[]>([])
  const muestra = useRef<Muestra | null>(null)
  const ultimaMuestra = useRef(0)
  /** El lienzo tiene tomas pegadas con distintos campos de visión. */
  const mezclado = useRef(false)
  const disparando = useRef(false)
  /** Se pone en false al salir: los await de comenzar() lo consultan. */
  const vivo = useRef(true)
  /** Cancelador de la vigilancia de la cámara (llamada, silencio, calor). */
  const vigilancia = useRef<(() => void) | null>(null)
  /** La URL del fantasma, para poder revocarla sin depender del estado. */
  const urlFantasma = useRef<string | null>(null)


  useEffect(() => {
    /* Si el recorrido no está, hay que decirlo ANTES de dejar tomar veinticinco
       fotos: al final, Guardar no tendría dónde guardarlas y la captura se
       perdería entera sin un solo mensaje. */
    void getTour(tourId)
      .then((t) => {
        if (t) setTour(t)
        else
          setFase({
            nombre: 'error',
            mensaje: 'Este recorrido ya no está guardado en este teléfono.',
            consejo: 'Regresa a Mis recorridos y vuelve a entrar.',
          })
      })
      .catch(() =>
        setFase({
          nombre: 'error',
          mensaje: 'No se pudo abrir el recorrido.',
          consejo: '¿El navegador está en modo privado?',
        }),
      )
  }, [tourId])

  /* --------------------------------------------------------------- LIMPIEZA */
  const apagar = useCallback(() => {
    vivo.current = false
    vigilancia.current?.()
    vigilancia.current = null
    cerrarCamara(sesion.current)
    sesion.current = null
    seguidor.stop()
    stitcher.current?.dispose()
    stitcher.current = null
    tomas.current = []
    hechos.current.clear()
    if (urlFantasma.current) {
      URL.revokeObjectURL(urlFantasma.current)
      urlFantasma.current = null
    }
  }, [seguidor])

  useEffect(() => apagar, [apagar])

  /* ------------------------------------------------------------- DIMENSIONES
   * El video se muestra recortado para llenar la pantalla (object-cover), así
   * que en pantalla se ve MENOS de lo que la foto captura. Los puntos guía se
   * proyectan con el campo de visión de lo que de verdad se ve; si se usara el
   * del fotograma completo, quedarían corridos hacia afuera. */
  const recalcularFov = useCallback(() => {
    const v = video.current
    const caja = contenedor.current
    /* `clientHeight` también, y no es redundante: cuando el contenedor se
       queda sin alto (un `height` que el navegador no entiende y descarta), el
       ancho SÍ es válido —viene de `w-full`— así que la guarda vieja dejaba
       pasar. Y con alto cero la cuenta se envenena en silencio: `visible` da 0,
       `fovPantalla` da 0, y más abajo `ancho / 0` es Infinity, que
       `Math.tan(0) * Infinity` convierte en NaN y termina en un
       `translateX(-NaN%)`. Un cinturón que no depende de que el CSS cargue. */
    if (!v || !caja || !v.videoWidth || !caja.clientWidth || !caja.clientHeight) return

    const { vfov } = fovDe(v.videoWidth, v.videoHeight, fovLargo.current)
    const escala = Math.max(caja.clientWidth / v.videoWidth, caja.clientHeight / v.videoHeight)
    const visible = Math.min(1, caja.clientHeight / (v.videoHeight * escala))
    setFovPantalla((2 * Math.atan(Math.tan((vfov * DEG) / 2) * visible)) / DEG)
    setCaja({ ancho: caja.clientWidth, alto: caja.clientHeight })
  }, [])

  /** Pinta (o quita) el fantasma de la toma anterior, sin fugar la URL vieja. */
  const mostrarFantasma = useCallback((blob: Blob | null) => {
    if (urlFantasma.current) URL.revokeObjectURL(urlFantasma.current)
    urlFantasma.current = blob ? URL.createObjectURL(blob) : null
    setFantasma(urlFantasma.current)
  }, [])

  /* ---------------------------------------------------------------- DISPARO */
  const tomarFoto = useCallback(
    (puntoId: string | null, orientacion: THREE.Quaternion, yaw: number, pitch: number) => {
      const v = video.current
      const st = stitcher.current
      // Devuelve si de verdad se tomó: el modo manual avanza el contador solo
      // cuando sí hubo foto.
      if (!v || !st || disparando.current) return false
      disparando.current = true

      const lienzo = capturarFotograma(v)
      const { hfov, vfov } = fovDe(lienzo.width, lienzo.height, fovLargo.current)
      const brillo = brilloDe(lienzo)

      // Al mundo de la panorámica: la primera dirección del plan queda al frente.
      const corregida = new THREE.Quaternion()
        .setFromAxisAngle(Y, baseYaw.current * DEG)
        .multiply(orientacion)

      st.agregar({ fuente: lienzo, orientacion: corregida, hfov, vfov, brillo })

      lienzo.toBlob(
        (blob) => {
          if (blob) {
            tomas.current.push({
              puntoId,
              blob,
              orientacion: orientacion.clone(),
              brillo,
              yaw,
              pitch,
            })
            setTomadas(tomas.current.length)
            if (manual) mostrarFantasma(blob)
          }
          soltarLienzo(lienzo)
          disparando.current = false
        },
        'image/jpeg',
        0.85,
      )

      if (puntoId) {
        hechos.current.add(puntoId)
        setCubiertos(hechos.current.size)
      }
      ultimaToma.current = performance.now()
      setCobertura(st.cobertura())
      return true
    },
    [manual, mostrarFantasma],
  )

  /* -------------------------------------------------------- BUCLE AUTOMÁTICO */
  useEffect(() => {
    if (fase.nombre !== 'capturando' || manual) return
    let frame = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)
      if (seguidor.state !== 'activo') return
      // Con el teléfono de lado, el plan no vale: no se dispara nada.
      if (girado) return

      const { yaw, pitch, speed, quaternion } = seguidor.reading
      const relativo = wrap180(yaw - baseYaw.current)

      const cercano = puntoMasCercano(planRef.current, hechos.current, relativo, pitch)
      const anterior = objetivo.current
      objetivo.current = cercano?.punto.id ?? null
      if (!cercano) {
        asentadoDesde.current = 0
        asentado.current = 0
        return
      }

      const ahora = performance.now()
      const enLaMira = cercano.distancia < TOLERANCIA_DEG && speed < QUIETO_DEG_S

      /* La cuenta se reinicia en cuanto la mira se sale o la mano se mueve, y
         también al cambiar de punto: si no, el tiempo que se estuvo quieto
         apuntando al punto anterior le contaría al siguiente y volveríamos a
         disparar de pasada, que es justo lo que se quiere evitar. */
      if (!enLaMira) {
        asentadoDesde.current = 0
      } else if (asentadoDesde.current === 0 || cercano.punto.id !== anterior) {
        asentadoDesde.current = ahora
      }

      const sostenido = asentadoDesde.current === 0 ? 0 : ahora - asentadoDesde.current
      asentado.current = Math.min(1, sostenido / ASENTAR_MS)

      const listo = sostenido >= ASENTAR_MS && ahora - ultimaToma.current > ESPERA_MS

      if (listo && tomarFoto(cercano.punto.id, quaternion, yaw, pitch)) {
        asentadoDesde.current = 0
        asentado.current = 0
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [fase.nombre, girado, manual, seguidor, tomarFoto])

  /* ------------------------------------------------- CALIBRAR MIENTRAS GIRAS
   * Se toma una miniatura del video cada tanto y se compara con la anterior.
   * Como se sabe cuánto giró el teléfono entre las dos, del corrimiento de la
   * imagen sale la distancia focal, y de ahí el campo de visión real del lente.
   *
   * Va aquí y no entre foto y foto porque la medición SOLO es confiable con
   * giros chicos: a más de veinte grados, la perspectiva estira el contenido y
   * la correlación deja de encontrar el corrimiento. Entre dos fotos del plan
   * hay más de treinta. Entre dos miniaturas del barrido, unos pocos. */
  useEffect(() => {
    if (fase.nombre !== 'capturando' || manual) return
    let frame = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)
      const v = video.current
      if (!v || !v.videoWidth || seguidor.state !== 'activo') return

      const ahora = performance.now()
      if (ahora - ultimaMuestra.current < MUESTREO_MS) return
      ultimaMuestra.current = ahora

      const { yaw, pitch } = seguidor.reading
      const anterior = muestra.current

      if (anterior) {
        const deltaYaw = wrap180(yaw - anterior.yaw)
        const deltaPitch = pitch - anterior.pitch
        // Todavía no se ha movido lo suficiente: se guarda la referencia.
        if (Math.abs(deltaYaw) < 3 && Math.abs(deltaPitch) < 3) return

        const grises = grisesReducidos(v, GRIS.ancho, GRIS.alto)
        const estimado = estimarFovConGiro({
          anterior: anterior.grises,
          actual: grises,
          width: GRIS.ancho,
          height: GRIS.alto,
          deltaYaw,
          deltaPitch,
        })

        if (estimado !== null) {
          estimaciones.current.push(
            ladoLargoDesdeHorizontal(estimado, v.videoWidth, v.videoHeight),
          )
          /* La corrección se aplica ENSEGUIDA: con el valor ya medido, las
             tomas que faltan se pegan en su lugar y los círculos guía caen
             donde de verdad apunta la cámara. Lo que ya quedó pegado con el
             valor viejo se arregla al terminar, recosiendo todo. */
          if (estimaciones.current.length >= 4) {
            const medido = mediana(estimaciones.current)
            if (medido !== null && Math.abs(medido - fovLargo.current) > 0.6) {
              fovLargo.current = medido
              mezclado.current = true
              recalcularFov()
            }
          }
        }
        muestra.current = { grises, yaw, pitch }
        return
      }

      muestra.current = { grises: grisesReducidos(v, GRIS.ancho, GRIS.alto), yaw, pitch }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [fase.nombre, manual, recalcularFov, seguidor])

  /* ----------------------------------------------------------------- ARRANQUE */
  const comenzar = useCallback(async () => {
    setFase({ nombre: 'abriendo' })
    setAviso(null)
    vivo.current = true
    setPermisoNegado(false)

    /* Preguntar por WebGL 2 ANTES de encender la cámara.
       La costura se arma en la GPU, y three.js pide un contexto `webgl2` y nada
       más; en un iPhone anterior a iOS 15 eso no existe. Sin esta puerta, el
       teléfono pedía permiso de cámara, encendía el lente, y reventaba al
       construir el costurero — y como ese error no es de tipo CameraError, el
       catch de más abajo lo reportaba como "No se pudo abrir la cámara", que es
       falso y manda a la persona a revisar permisos que estaban bien. Mejor
       decirlo en el segundo cero y no encender nada. */
    const webgl = detectWebGL()
    if (!webgl.ok) {
      setFase({
        nombre: 'error',
        mensaje: 'Este teléfono no puede armar la panorámica',
        consejo:
          webgl.causa === 'sin-webgl2'
            ? 'La costura se hace en la tarjeta gráfica y necesita WebGL 2; en un iPhone hace falta iOS 15 o más nuevo. Sí puedes subir una foto 360 que ya tengas y ver recorridos.'
            : 'El navegador no entregó un contexto WebGL. Prueba cerrando pestañas, o apagando el Modo de bajo consumo, y vuelve a entrar.',
      })
      return
    }

    if (needsOrientationPermission()) {
      const permiso = await requestOrientationPermission()
      if (permiso === 'denied') setPermisoNegado(true)
    }

    try {
      let abierta = await abrirCamara()
      /* Salirse mientras el sistema pide el permiso o abre el lente es normal:
         el botón × ya está en pantalla. Si no se comprueba, la cámara se queda
         encendida (con su luz prendida) y el contexto WebGL huérfano. */
      if (!vivo.current) {
        cerrarCamara(abierta)
        return
      }
      /* Con el permiso ya dado, las etiquetas de las cámaras dejan de venir
         vacías y se puede escoger el lente principal en vez de la gran angular
         o la "virtual", que cambia de lente sola a media captura. */
      const preferida = elegirLentePrincipal(await listarCamaras())
      if (preferida && preferida !== abierta.track.getSettings().deviceId) {
        try {
          const mejor = await abrirCamara(preferida)
          cerrarCamara(abierta)
          abierta = mejor
        } catch {
          // Si el lente elegido no abre, seguimos con el que ya teníamos.
        }
      }

      sesion.current = abierta
      await fijarExposicion(abierta)

      const v = video.current
      if (!v) throw new CameraError('desconocido', 'No se encontró el visor de la cámara.')
      v.srcObject = abierta.stream
      await v.play().catch(() => undefined)
      await esperarVideo(v)
      if (!vivo.current) return

      vigilancia.current?.()
      vigilancia.current = vigilarCamara(abierta, (motivo) => {
        if (motivo === 'interrumpida') setAviso('La cámara se pausó. Vuelve a la app para seguir.')
        if (motivo === 'terminada') setAviso('La cámara se cerró. Guarda lo que llevas y vuelve a entrar.')
        if (motivo === 'cambio-de-formato') {
          setAviso('El teléfono cambió la calidad de la cámara. Termina esta habitación para no mezclar tomas.')
        }
      })

      // El lienzo más grande que este teléfono puede armar de verdad.
      const ancho = anchoUtilizable()
      // Si esto es un reintento, hay un costurero (y su contexto WebGL) vivo.
      stitcher.current?.dispose()
      stitcher.current = new PanoramaStitcher({ width: ancho, preview: { width: 512, height: 256 } })
      if (previa.current) {
        /* Vaciar a mano y no con replaceChildren(): ese método es de Safari 14
           y de Chrome 86, o sea que se cae en DOS de los cuatro navegadores del
           target. Y el TypeError caía en el catch de más abajo, que como no
           reconoce el tipo del error acusa a la cámara —"No se pudo abrir la
           cámara"— cuando la cámara ya había abierto y estaba dando imagen.
           `append` de la línea siguiente sí es viejo (Safari 10), se queda. */
        const caja = previa.current
        while (caja.firstChild) caja.removeChild(caja.firstChild)
        stitcher.current.canvas.className = 'h-full w-full object-cover'
        previa.current.append(stitcher.current.canvas)
      }

      seguidor.onStateChange = setEstadoSensor
      seguidor.start()

      // Se espera un momento a que lleguen lecturas antes de decidir si hay
      // sensores: preguntar si el evento existe no sirve de nada.
      await new Promise((resolve) => setTimeout(resolve, 900))
      if (!vivo.current) return

      const hayS = seguidor.state === 'activo'
      setManual(!hayS)
      baseYaw.current = hayS ? seguidor.reading.yaw : 0

      const { hfov, vfov } = fovDe(v.videoWidth, v.videoHeight, fovLargo.current)
      setAnguloInicial(screenAngle())
      setGirado(false)
      fovLargo.current = FOV_LADO_LARGO
      estimaciones.current = []
      muestra.current = null
      mezclado.current = false
      const plan = planDeCaptura({ hfov, vfov, alcance: hayS ? alcance : 'vuelta' })
      planRef.current = plan
      /* El plan vive en coordenadas de la PANORÁMICA (el frente es el yaw 0) y
         el sensor entrega coordenadas del MUNDO. Para dibujarlos encima de la
         cámara hay que sumarles el rumbo que tenía el teléfono al empezar; si
         no, los círculos aparecen girados justo esa cantidad. */
      setPuntos(plan.map((punto) => ({ ...punto, yaw: wrap180(punto.yaw + baseYaw.current) })))
      recalcularFov()
      setFase({ nombre: 'capturando' })
    } catch (error) {
      const mensaje = error instanceof CameraError ? error.message : 'No se pudo abrir la cámara.'
      setFase({
        nombre: 'error',
        mensaje,
        consejo: error instanceof CameraError ? error.detail : undefined,
      })
    }
  }, [alcance, recalcularFov, seguidor])

  useEffect(() => {
    const alGirar = () => {
      recalcularFov()
      /* El plan de captura se calculó con la forma del encuadre en vertical.
         Al girar el teléfono, el ancho y el alto se intercambian y los puntos
         guía dejan de repartirse bien: quedarían huecos. En vez de recalcular
         el plan a media captura —lo que movería los círculos ya tomados— se
         pide enderezar el teléfono. */
      setGirado(screenAngle() !== anguloInicial)
    }
    window.addEventListener('resize', alGirar)
    window.addEventListener('orientationchange', alGirar)
    return () => {
      window.removeEventListener('resize', alGirar)
      window.removeEventListener('orientationchange', alGirar)
    }
  }, [anguloInicial, recalcularFov])

  /** La pantalla no se apaga mientras se está capturando. */
  useEffect(() => {
    if (fase.nombre !== 'capturando') return
    return mantenerPantallaEncendida()
  }, [fase.nombre])

  /* ------------------------------------------------------- DESHACER Y CERRAR */
  const recoser = useCallback(async (fovFinal: number) => {
    const st = stitcher.current
    if (!st) return
    st.limpiar()
    const lienzo = document.createElement('canvas')
    const ctx = lienzo.getContext('2d', { alpha: false })

    try {
      for (const toma of tomas.current) {
        const bitmap = await createImageBitmap(toma.blob)
        // Recoser 25 tomas tarda segundos; si el usuario se sale a media
        // operación, seguir dibujando sobre un costurero ya destruido explota.
        if (stitcher.current !== st) {
          bitmap.close()
          return
        }
        lienzo.width = bitmap.width
        lienzo.height = bitmap.height
        ctx?.drawImage(bitmap, 0, 0)
        bitmap.close()

        const { hfov, vfov } = fovDe(lienzo.width, lienzo.height, fovFinal)
        const corregida = new THREE.Quaternion()
          .setFromAxisAngle(Y, baseYaw.current * DEG)
          .multiply(toma.orientacion)
        st.agregar({ fuente: lienzo, orientacion: corregida, hfov, vfov, brillo: toma.brillo })
      }
      setCobertura(st.cobertura())
    } finally {
      soltarLienzo(lienzo)
    }
  }, [])

  const deshacer = useCallback(async () => {
    /* La toma más reciente puede seguir comprimiéndose a JPEG: sin esperarla,
       el pop() se lleva la ANTERIOR y la que se quería borrar se queda. */
    for (let intento = 0; disparando.current && intento < 40; intento++) {
      await new Promise((seguir) => setTimeout(seguir, 50))
    }

    const ultima = tomas.current.pop()
    if (!ultima) return
    if (ultima.puntoId) {
      hechos.current.delete(ultima.puntoId)
      setCubiertos(hechos.current.size)
      // A mano, el contador de pasos ES el avance: si no retrocede, el punto
      // que se acaba de deshacer no se vuelve a fotografiar nunca.
      if (manual) setPasoManual((n) => Math.max(0, n - 1))
    }
    setTomadas(tomas.current.length)
    // El fantasma tiene que volver a ser la foto que ahora sí es la última.
    if (manual) mostrarFantasma(tomas.current[tomas.current.length - 1]?.blob ?? null)

    setFase({
      nombre: 'procesando',
      mensaje:
        tomas.current.length > 8
          ? 'Quitando la última toma y volviendo a unir las demás. Tarda unos segundos…'
          : 'Quitando la última toma…',
    })
    try {
      await recoser(fovLargo.current)
      mezclado.current = false
    } catch {
      setAviso('No se pudo volver a unir las fotos. Puedes seguir tomando o terminar así.')
    }
    setFase({ nombre: 'capturando' })
  }, [manual, mostrarFantasma, recoser])

  const terminar = useCallback(async () => {
    const st = stitcher.current
    if (!st || tomas.current.length === 0) return

    /* La última toma puede estar todavía comprimiéndose a JPEG. Si se recose
       antes de que entre a la lista, esa foto desaparece de la panorámica. */
    for (let intento = 0; disparando.current && intento < 40; intento++) {
      await new Promise((seguir) => setTimeout(seguir, 50))
    }

    /* Si el giroscopio dio suficientes mediciones del campo de visión, se vuelve
       a coser TODO con el valor calibrado. Es la diferencia entre una panorámica
       que cierra y una en la que las paredes no empatan: el valor por defecto de
       66° puede estar cinco grados lejos del lente real, y ese error se acumula
       vuelta tras vuelta. */
    const calibrado = mediana(estimaciones.current)
    if (calibrado !== null && (mezclado.current || Math.abs(calibrado - fovLargo.current) > 1.2)) {
      setFase({
        nombre: 'procesando',
        mensaje: 'Midiendo el lente y volviendo a unir las fotos. Tarda unos segundos…',
      })
      fovLargo.current = calibrado
      mezclado.current = false
      try {
        await recoser(calibrado)
      } catch {
        // Si no se pudo recoser, lo que ya está en el lienzo sigue sirviendo.
        setAviso('No se pudo afinar la unión de las fotos; la panorámica se guarda como está.')
      }
    }

    setFase({ nombre: 'procesando', mensaje: 'Armando la foto 360…' })
    try {
      const foto = await st.exportar(0.86)

      /* La miniatura se saca pidiéndole al navegador que decodifique la foto YA
         reducida. Decodificarla completa aquí sumaría 33 MB de bitmap más otro
         tanto de canvas justo en el peor momento de memoria de toda la app:
         acaban de convivir el lienzo del costurero, su lectura de píxeles y el
         JPEG recién armado. */
      const chico = await createImageBitmap(foto, { resizeWidth: 320, resizeQuality: 'high' })
      const lienzo = document.createElement('canvas')
      lienzo.width = chico.width
      lienzo.height = chico.height
      lienzo.getContext('2d', { alpha: false })?.drawImage(chico, 0, 0)
      chico.close()
      const mini = await miniatura(lienzo, 320)
      soltarLienzo(lienzo)

      const existente = sceneId ? tour?.scenes.find((s) => s.id === sceneId) : undefined
      setNombre(existente?.name ?? sugerirNombre(tour))
      setFase({ nombre: 'nombrar', foto, mini, cobertura: st.cobertura() })
    } catch (error) {
      setFase({
        nombre: 'error',
        mensaje: 'No se pudo armar la foto 360.',
        consejo: error instanceof Error ? error.message : undefined,
      })
    }
  }, [recoser, sceneId, tour])

  const guardar = useCallback(async () => {
    if (fase.nombre !== 'nombrar' || !tour) return
    const rescate = fase
    setFase({ nombre: 'procesando', mensaje: 'Guardando…' })
    try {
      if (sceneId) {
        await reemplazarFoto({
          tour,
          sceneId,
          foto: fase.foto,
          miniatura: fase.mini,
          origin: 'captura',
          coverageDeg: Math.round(fase.cobertura * 360),
        })
        apagar()
        ir({ nombre: 'puntos', tourId: tour.id, sceneId })
        return
      }

      const scene = createScene({
        id: slugId(nombre || 'habitacion'),
        name: nombre.trim() || 'Habitación',
        imageId: newId('img'),
        thumbId: newId('img'),
        origin: 'captura',
        coverageDeg: Math.round(fase.cobertura * 360),
      })
      await guardarEscenaConFoto({ tour, scene, foto: fase.foto, miniatura: fase.mini })
      apagar()
      ir({ nombre: 'puntos', tourId: tour.id, sceneId: scene.id })
    } catch (error) {
      /* CRÍTICO: se vuelve a la hoja de nombrar con la MISMA foto en la mano.
         Mandar esto a la pantalla de error tiraría el objeto de la fase, o sea
         la panorámica recién armada: veinticinco fotos y dos minutos de trabajo
         perdidos por un teléfono sin espacio. Así el usuario puede hacer lugar
         y volver a tocar Guardar. */
      setFase(rescate)
      setAviso(
        error instanceof Error && /quota|space|almacen/i.test(error.message)
          ? 'No hay espacio en el teléfono. Borra algo y vuelve a tocar Guardar; la foto no se ha perdido.'
          : 'No se pudo guardar. Vuelve a tocar Guardar; la foto no se ha perdido.',
      )
    }
  }, [apagar, fase, ir, nombre, sceneId, tour])

  /* ------------------------------------------------------------- MODO MANUAL */
  const dispararManual = useCallback(() => {
    const plan = planRef.current
    const punto = plan[pasoManual]
    if (!punto) return

    const usaSensor = seguidor.state === 'activo'

    const orientacion = usaSensor
      ? seguidor.reading.quaternion
      : new THREE.Quaternion().setFromEuler(
          new THREE.Euler(punto.pitch * DEG, -punto.yaw * DEG, 0, 'YXZ'),
        )

    const yaw = usaSensor ? seguidor.reading.yaw : punto.yaw + baseYaw.current
    const pitch = usaSensor ? seguidor.reading.pitch : punto.pitch

    if (tomarFoto(punto.id, orientacion, yaw, pitch)) setPasoManual((n) => n + 1)
  }, [pasoManual, seguidor, tomarFoto])

  /* ------------------------------------------------------------------ VISTAS */
  if (fase.nombre === 'permisos') {
    return (
      <Pantalla
        titulo={sceneId ? 'Volver a tomar la foto' : 'Tomar la foto 360'}
        atras={() => ir({ nombre: 'editar', tourId })}
      >
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          {sceneId && (
            <Aviso tono="alerta" titulo="Se va a reemplazar la foto">
              El nombre de la habitación y sus puntos se conservan tal cual. La foto anterior sí se
              borra.
            </Aviso>
          )}
          {!contextoSeguro() && (
            <Aviso tono="error" titulo="Aquí no se puede usar la cámara">
              El navegador solo deja abrir la cámara cuando la página viene por <b>https</b>. Si
              estás probando desde la computadora con la dirección de la red local, abre en su lugar
              el visor publicado, o usa <b>Usar una foto que ya tengo</b>.
            </Aviso>
          )}

          <Aviso titulo="Cómo va a funcionar">
            <ol className="ml-4 list-decimal space-y-1.5">
              <li>Párate en el centro del cuarto y no te muevas de ahí.</li>
              <li>Van a aparecer unos círculos. Apunta la cámara a cada uno.</li>
              <li>
                Deténte sobre el círculo y aguanta quieto un par de segundos: el aro se va
                cerrando y, al completarse, la foto se toma sola. Si te mueves, la cuenta
                vuelve a empezar.
              </li>
              <li>Al terminar, el visor une todas las fotos en una sola de 360°.</li>
            </ol>
          </Aviso>

          <div>
            <p className="mb-2 text-xs font-medium text-ink-200">¿Qué tanto quieres cubrir?</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAlcance('esfera')}
                className={`rounded-2xl border p-3 text-left text-sm ${
                  alcance === 'esfera'
                    ? 'border-brand-500 bg-brand-500/10'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                <b className="block">Todo el cuarto</b>
                <span className="text-xs text-ink-200">Incluye techo y piso. Unas 30 fotos.</span>
              </button>
              <button
                type="button"
                onClick={() => setAlcance('vuelta')}
                className={`rounded-2xl border p-3 text-left text-sm ${
                  alcance === 'vuelta'
                    ? 'border-brand-500 bg-brand-500/10'
                    : 'border-white/10 bg-white/5'
                }`}
              >
                <b className="block">Solo la vuelta</b>
                <span className="text-xs text-ink-200">Rápido. Techo y piso quedan vacíos.</span>
              </button>
            </div>
          </div>

          <Boton tipo="principal" ancho onClick={() => void comenzar()} disabled={!contextoSeguro()}>
            Abrir la cámara
          </Boton>
          <p className="text-center text-xs text-ink-200">
            El teléfono va a pedirte permiso para la cámara y para los sensores de movimiento. Las
            fotos no salen de tu teléfono.
          </p>
        </div>
      </Pantalla>
    )
  }

  if (fase.nombre === 'error') {
    return (
      <Pantalla titulo="Tomar la foto 360" atras={() => ir({ nombre: 'editar', tourId })}>
        <div className="mx-auto w-full max-w-md">
          <Aviso tono="error" titulo="No se pudo">
            {fase.mensaje}
            {fase.consejo && (
              <p className="mt-2 font-mono text-xs opacity-70">{fase.consejo}</p>
            )}
          </Aviso>
          <div className="mt-4">
            <Boton
              ancho
              onClick={() => {
                // Sin esto, un reintento deja la cámara anterior encendida.
                apagar()
                setFase({ nombre: 'permisos' })
              }}
            >
              Volver a intentar
            </Boton>
          </div>
        </div>
      </Pantalla>
    )
  }

  const pendientes = puntos.length - cubiertos

  /* Cuánto hay que correr el fantasma de la toma anterior.
     Si entre foto y foto se gira `paso` grados y en la pantalla caben `hfov`
     grados, la imagen anterior se corre esa misma proporción del ancho: lo que
     queda visible del fantasma es justo el traslape que hay que hacer coincidir. */
  const hfovPantalla =
    (2 * Math.atan(Math.tan((fovPantalla * DEG) / 2) * (caja.ancho / caja.alto))) / DEG
  const pasoPlan = puntos.length > 1 ? 360 / Math.max(1, puntos.filter((p) => p.anillo === 0).length) : 60
  const corrimientoFantasma = Math.min(95, (pasoPlan / Math.max(20, hfovPantalla)) * 100)

  return (
    <div ref={contenedor} className="alto-pantalla relative w-full overflow-hidden bg-black">
      <video
        ref={video}
        playsInline
        muted
        autoPlay
        onLoadedMetadata={recalcularFov}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Fantasma de la toma anterior: en modo manual es la única referencia
          para saber cuánto girar. Se corre para que su orilla derecha caiga
          donde debe empezar la nueva foto. */}
      {manual && fantasma && (
        <img
          src={fantasma}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35"
          style={{ transform: `translateX(-${corrimientoFantasma.toFixed(1)}%)` }}
        />
      )}

      {fase.nombre === 'capturando' && !manual && (
        <GuiaCaptura
          puntos={puntos}
          hechos={hechos}
          lectura={seguidor.reading}
          fovPantalla={fovPantalla}
          objetivo={objetivo}
          asentado={asentado}
        />
      )}

      {/* ---------------------------------------------------------- HUD ---- */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
        <div className="flex items-start gap-2 p-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <button
            type="button"
            onClick={() => {
              apagar()
              ir({ nombre: 'editar', tourId })
            }}
            className="hud-glass pointer-events-auto grid h-11 w-11 shrink-0 place-items-center rounded-full"
            aria-label="Salir"
          >
            ×
          </button>

          <div className="hud-glass pointer-events-auto min-w-0 flex-1 rounded-hud px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-ink-50">
                {tomadas} {tomadas === 1 ? 'foto' : 'fotos'}
              </span>
              <span className="text-ink-200">{Math.round(cobertura * 100)} % cubierto</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-300"
                style={{ width: `${Math.round(cobertura * 100)}%` }}
              />
            </div>
          </div>

          {/* Vista previa de la panorámica que se va armando. */}
          <div
            ref={previa}
            className="hud-glass h-14 w-28 shrink-0 overflow-hidden rounded-xl"
            aria-label="Cómo va quedando"
          />
        </div>

        <div className="flex flex-col gap-3 p-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {girado && (
            <div className="pointer-events-auto">
              <Aviso tono="alerta" titulo="Endereza el teléfono">
                Los puntos se calcularon con el teléfono vertical. Regrésalo a como estaba para
                seguir tomando fotos.
              </Aviso>
            </div>
          )}

          {aviso && (
            <div className="pointer-events-auto">
              <Aviso tono="alerta">{aviso}</Aviso>
            </div>
          )}

          {/* Solo hasta la primera foto: después ya entendió cómo va, y el
              panel le estaría comiendo media pantalla a la cámara. */}
          {estadoSensor === 'no-soportado' && tomadas === 0 && (
            <div className="pointer-events-auto">
              {permisoNegado ? (
                <Aviso tono="alerta" titulo="Dijiste que no a los sensores">
                  Sin ellos, el teléfono no sabe hacia dónde apunta y las fotos se toman a mano.
                  Para que se tomen solas: recarga la página, toca de nuevo <b>Abrir la cámara</b> y
                  acepta el permiso de movimiento y orientación.
                </Aviso>
              ) : (
                <Aviso tono="alerta" titulo="Sin sensores de movimiento">
                  Este teléfono no está diciendo hacia dónde apunta, así que la foto se toma a mano:
                  dispara, gira hasta que la imagen de fondo empate con lo que ves, y vuelve a
                  disparar.
                </Aviso>
              )}
            </div>
          )}

          <p className="text-center text-xs text-ink-200 drop-shadow">
            {manual
              ? `Toma ${pasoManual + 1} de ${puntos.length}. Gira hasta empatar con la imagen de fondo.`
              : pendientes > 0
                ? 'Apunta al círculo naranja y sostén el teléfono quieto hasta que el aro se cierre.'
                : '¡Listo! Ya cubriste todo. Toca Terminar.'}
          </p>

          <div className="pointer-events-auto flex items-center justify-between gap-3">
            <Boton onClick={() => void deshacer()} disabled={tomadas === 0}>
              Deshacer
            </Boton>

            <button
              type="button"
              onClick={() => (manual ? dispararManual() : dispararLibre())}
              aria-label="Tomar foto"
              className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full border-4
                         border-white/80 bg-white/20 transition-transform active:scale-95"
            >
              <span className="block h-14 w-14 rounded-full bg-white" />
            </button>

            <Boton tipo="principal" onClick={() => void terminar()} disabled={tomadas === 0}>
              Terminar
            </Boton>
          </div>
        </div>
      </div>

      {fase.nombre === 'procesando' && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/80">
          <Cargando texto={fase.mensaje} />
        </div>
      )}

      {fase.nombre === 'nombrar' && (
        <Hoja
          titulo={sceneId ? '¿Así queda?' : '¿Qué cuarto es?'}
          onCerrar={() => setFase({ nombre: 'capturando' })}
        >
          <div className="flex flex-col gap-3">
            {aviso && <Aviso tono="error">{aviso}</Aviso>}
            {fase.cobertura < 0.75 && (
              <Aviso tono="alerta">
                Quedaron huecos sin fotografiar ({Math.round(fase.cobertura * 100)} % cubierto). Se
                van a ver como zonas grises. Puedes cerrar esto y seguir tomando fotos.
              </Aviso>
            )}
            <Campo
              etiqueta="Nombre de la habitación"
              valor={nombre}
              onChange={setNombre}
              placeholder="Sala"
              maxLength={40}
            />
            <Boton tipo="principal" ancho onClick={() => void guardar()}>
              {sceneId ? 'Reemplazar la foto' : 'Guardar habitación'}
            </Boton>
          </div>
        </Hoja>
      )}
    </div>
  )

  /** Disparo con el botón, usando la orientación de este instante. */
  function dispararLibre() {
    if (seguidor.state !== 'activo') return
    const { yaw, pitch, quaternion } = seguidor.reading
    const relativo = wrap180(yaw - baseYaw.current)
    const cercano = puntoMasCercano(planRef.current, hechos.current, relativo, pitch)
    // Si estás cerca de un punto pendiente, cuenta como ese punto; si no, es una
    // foto extra que suma cobertura pero no tacha ninguno.
    const id = cercano && cercano.distancia < TOLERANCIA_DEG * 1.6 ? cercano.punto.id : null
    tomarFoto(id, quaternion, yaw, pitch)
  }
}

function sugerirNombre(tour: StoredTour | null): string {
  const usados = new Set((tour?.scenes ?? []).map((s) => s.name.toLowerCase()))
  for (const nombre of ['Sala', 'Cocina', 'Comedor', 'Recámara', 'Baño', 'Patio', 'Cochera']) {
    if (!usados.has(nombre.toLowerCase())) return nombre
  }
  return `Habitación ${(tour?.scenes.length ?? 0) + 1}`
}

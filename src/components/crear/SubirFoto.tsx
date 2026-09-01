/* oxlint-disable react/set-state-in-effect -- Los efectos sincronizan con la
   decodificación de imágenes y con IndexedDB, que son sistemas externos. */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Ruta } from '../../lib/useHashRoute'
import type { StoredTour } from '../../lib/store/types'
import {
  createScene,
  getTour,
  guardarEscenaConFoto,
  reemplazarFoto,
} from '../../lib/store/tours'
import { newId, slugId } from '../../lib/store/ids'
import { anchoUtilizable, miniatura, soltarLienzo } from '../../lib/capture/frames'
import {
  ImportError,
  adivinarTipo,
  aEquirectangular,
  aJpeg,
  leerGPano,
  leerImagen,
  liberarProyector,
  type GPano,
  type TipoDeFoto,
} from '../../lib/capture/importar'
import { Aviso, Boton, Campo, Cargando, Pantalla, Tarjeta } from './ui'

export type SubirFotoProps = {
  tourId: string
  /** Si viene, la foto REEMPLAZA la de esa habitación conservando sus puntos. */
  sceneId?: string
  ir: (ruta: Ruta) => void
}

const ANCHO_PREVIA = 1024

const DESCRIPCIONES: Record<TipoDeFoto, { titulo: string; texto: string }> = {
  esfera: {
    titulo: 'Foto 360 completa',
    texto: 'De una cámara 360 (Insta360, Theta) o del modo “Foto esférica”. Cubre todo el cuarto.',
  },
  panoramica: {
    titulo: 'Panorámica del celular',
    texto: 'La del modo Panorámica: una tira ancha que cubre una parte de la vuelta.',
  },
  foto: {
    titulo: 'Foto normal',
    texto: 'Una foto cualquiera. Solo se va a ver esa pared; el resto queda vacío.',
  },
}

export function SubirFoto({ tourId, sceneId, ir }: SubirFotoProps) {
  const [tour, setTour] = useState<StoredTour | null>(null)
  const [origen, setOrigen] = useState<HTMLCanvasElement | null>(null)
  const [gpano, setGpano] = useState<GPano | null>(null)
  const [tipo, setTipo] = useState<TipoDeFoto>('esfera')
  const [cobertura, setCobertura] = useState(200)
  const [fov, setFov] = useState(66)
  const [nombre, setNombre] = useState('')
  const [previa, setPrevia] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<{ mensaje: string; consejo?: string } | null>(null)

  const galeria = useRef<HTMLInputElement>(null)
  const camara = useRef<HTMLInputElement>(null)
  const urlPrevia = useRef<string | null>(null)
  /** El lienzo de la foto original, para poder soltarlo al salir. */
  const lienzoOrigen = useRef<HTMLCanvasElement | null>(null)
  /** Contador de vistas previas: la que llega tarde ya no manda. */
  const generacion = useRef(0)

  useEffect(() => {
    void getTour(tourId).then(setTour)
  }, [tourId])

  /* Al salir de la pantalla se sueltan las dos cosas caras: la URL de la vista
     previa y el contexto WebGL que usa la proyección de una foto normal. */
  /* Al salir se sueltan las tres cosas caras: la URL de la vista previa, el
     contexto WebGL de la proyección y el lienzo de la foto original — que para
     una foto de iPhone de 4032×3024 son unos 48 MB. */
  useEffect(
    () => () => {
      generacion.current++
      if (urlPrevia.current) URL.revokeObjectURL(urlPrevia.current)
      urlPrevia.current = null
      if (lienzoOrigen.current) soltarLienzo(lienzoOrigen.current)
      lienzoOrigen.current = null
      liberarProyector()
    },
    [],
  )

  const elegir = async (file: File) => {
    setError(null)
    setTrabajando(true)
    try {
      const [lienzo, metadatos] = await Promise.all([leerImagen(file), leerGPano(file)])
      if (lienzoOrigen.current) soltarLienzo(lienzoOrigen.current)
      lienzoOrigen.current = lienzo
      setOrigen(lienzo)
      setGpano(metadatos)
      const adivinado = adivinarTipo(lienzo.width, lienzo.height, metadatos)
      setTipo(adivinado)
      if (adivinado === 'panoramica' && !metadatos) {
        // Una tira de 4:1 abarca aproximadamente el doble de lo que abarca su
        // alto; se arranca de ahí y el usuario ajusta viendo el resultado.
        setCobertura(Math.min(360, Math.round((lienzo.width / lienzo.height) * 55)))
      }
      setNombre(
        (sceneId ? tour?.scenes.find((s) => s.id === sceneId)?.name : undefined) ??
          sugerirNombre(tour),
      )
    } catch (e) {
      setError(
        e instanceof ImportError
          ? { mensaje: e.message, consejo: e.consejo }
          : { mensaje: 'No se pudo abrir la foto.' },
      )
    } finally {
      setTrabajando(false)
      if (galeria.current) galeria.current.value = ''
      if (camara.current) camara.current.value = ''
    }
  }

  /* Vista previa chica: armarla a tamaño completo en cada movimiento del
     deslizador tardaría segundos. A 1024 px se ve igual de bien para decidir. */
  const construirPrevia = useCallback(async () => {
    if (!origen) return
    // Dos construcciones encimadas (el deslizador se mueve mientras una corre)
    // terminarían en orden impredecible y la vista previa se quedaría mostrando
    // los parámetros viejos. Gana la última que empezó.
    const mia = ++generacion.current

    const lienzo = await aEquirectangular(origen, {
      tipo,
      gpano,
      anchoDestino: ANCHO_PREVIA,
      coberturaDeg: cobertura,
      fovDeg: fov,
    })
    const blob = await aJpeg(lienzo, 0.8)
    soltarLienzo(lienzo)

    if (mia !== generacion.current) return
    if (urlPrevia.current) URL.revokeObjectURL(urlPrevia.current)
    urlPrevia.current = URL.createObjectURL(blob)
    setPrevia(urlPrevia.current)
  }, [cobertura, fov, gpano, origen, tipo])

  useEffect(() => {
    if (!origen) return
    // Una foto normal pasa por la GPU; las otras dos son un drawImage. Se le da
    // más aire al deslizador para no rearmar la proyección en cada píxel.
    const espera = tipo === 'foto' ? 320 : 120
    const timer = window.setTimeout(() => void construirPrevia(), espera)
    return () => window.clearTimeout(timer)
  }, [construirPrevia, origen, tipo])

  const guardar = async () => {
    if (!origen || !tour) return
    setTrabajando(true)
    setError(null)
    try {
      const lienzo = await aEquirectangular(origen, {
        tipo,
        gpano,
        anchoDestino: anchoUtilizable(),
        coberturaDeg: cobertura,
        fovDeg: fov,
      })
      const foto = await aJpeg(lienzo, 0.86)
      const mini = await miniatura(lienzo)
      soltarLienzo(lienzo)

      const grados =
        tipo === 'esfera' ? 360 : tipo === 'panoramica' ? cobertura : Math.round(fov)

      if (sceneId) {
        await reemplazarFoto({
          tour,
          sceneId,
          foto,
          miniatura: mini,
          origin: 'foto',
          coverageDeg: grados,
        })
        ir({ nombre: 'puntos', tourId: tour.id, sceneId })
        return
      }

      const scene = createScene({
        id: slugId(nombre || 'habitacion'),
        name: nombre.trim() || 'Habitación',
        imageId: newId('img'),
        thumbId: newId('img'),
        origin: 'foto',
        coverageDeg: grados,
      })
      await guardarEscenaConFoto({ tour, scene, foto, miniatura: mini })
      ir({ nombre: 'puntos', tourId: tour.id, sceneId: scene.id })
    } catch (e) {
      setError({ mensaje: e instanceof Error ? e.message : 'No se pudo guardar la habitación.' })
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <Pantalla
      titulo={sceneId ? 'Cambiar la foto' : 'Usar una foto'}
      subtitulo={tour?.title}
      atras={() => ir({ nombre: 'editar', tourId })}
    >
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        {sceneId && !origen && (
          <Aviso tono="alerta" titulo="Se va a reemplazar la foto">
            El nombre de la habitación y sus puntos se conservan tal cual. La foto anterior sí se
            borra.
          </Aviso>
        )}
        {error && (
          <Aviso tono="error" titulo="No se pudo abrir">
            {error.mensaje}
            {error.consejo && <p className="mt-2">{error.consejo}</p>}
          </Aviso>
        )}

        {!origen ? (
          <>
            <Aviso titulo="Qué fotos sirven">
              Lo mejor es una <b>foto 360</b> de una cámara esférica. También funciona la{' '}
              <b>panorámica</b> del celular, aunque deja huecos, y hasta una foto normal para
              enseñar una sola pared.
            </Aviso>

            <Boton tipo="principal" ancho onClick={() => galeria.current?.click()} disabled={trabajando}>
              Elegir de la galería
            </Boton>
            <Boton ancho onClick={() => camara.current?.click()} disabled={trabajando}>
              Tomar una foto ahora
            </Boton>

            {/* accept="image/*" a secas y SIN nombrar HEIC: cuando el accept no
                lo menciona, el iPhone convierte la foto a JPG antes de
                entregarla, y así el problema del HEIC desaparece solo. */}
            <input
              ref={galeria}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void elegir(file)
              }}
            />
            <input
              ref={camara}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void elegir(file)
              }}
            />

            {trabajando && <Cargando texto="Abriendo la foto…" />}
          </>
        ) : (
          <>
            <div className="overflow-hidden rounded-hud border border-white/10 bg-black">
              {previa ? (
                <img src={previa} alt="Cómo va a quedar" className="w-full" />
              ) : (
                <div className="grid h-40 place-items-center text-sm text-ink-200">Preparando…</div>
              )}
            </div>
            <p className="-mt-2 text-center text-xs text-ink-200">
              Así se va a desdoblar el cuarto. Lo gris es lo que no cubre la foto.
            </p>

            {gpano && (
              <Aviso tono="alerta" titulo="La foto trae sus datos">
                Esta imagen dice exactamente qué parte de la esfera cubre, así que se colocó sola,
                sin que tengas que ajustar nada.
              </Aviso>
            )}

            <div className="flex flex-col gap-2">
              {(Object.keys(DESCRIPCIONES) as TipoDeFoto[]).map((opcion) => (
                <button
                  key={opcion}
                  type="button"
                  onClick={() => setTipo(opcion)}
                  className={`rounded-2xl border p-3 text-left ${
                    tipo === opcion ? 'border-brand-500 bg-brand-500/10' : 'border-white/10 bg-white/5'
                  }`}
                >
                  <b className="block text-sm">{DESCRIPCIONES[opcion].titulo}</b>
                  <span className="text-xs text-ink-200">{DESCRIPCIONES[opcion].texto}</span>
                </button>
              ))}
            </div>

            {tipo === 'panoramica' && !gpano && (
              <label className="block">
                <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-ink-200">
                  <span>¿Cuánto giraste al tomarla?</span>
                  <span className="text-ink-50">{cobertura}°</span>
                </span>
                <input
                  type="range"
                  min={40}
                  max={360}
                  step={5}
                  value={cobertura}
                  onChange={(e) => setCobertura(Number(e.target.value))}
                  className="w-full accent-brand-500"
                />
                <span className="mt-1.5 block text-xs text-ink-200/70">
                  Muévelo hasta que las puertas y los muebles se vean con su ancho normal. 360° es
                  la vuelta completa.
                </span>
              </label>
            )}

            {tipo === 'foto' && (
              <label className="block">
                <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-ink-200">
                  <span>Qué tan abierta es la foto</span>
                  <span className="text-ink-50">{fov}°</span>
                </span>
                <input
                  type="range"
                  min={35}
                  max={120}
                  step={1}
                  value={fov}
                  onChange={(e) => setFov(Number(e.target.value))}
                  className="w-full accent-brand-500"
                />
                <span className="mt-1.5 block text-xs text-ink-200/70">
                  La cámara normal de un celular anda por los 66°.
                </span>
              </label>
            )}

            {!sceneId && (
              <Campo
                etiqueta="Nombre de la habitación"
                valor={nombre}
                onChange={setNombre}
                placeholder="Sala"
                maxLength={40}
              />
            )}

            <div className="flex gap-2">
              <Boton
                ancho
                onClick={() => {
                  generacion.current++
                  soltarLienzo(origen)
                  lienzoOrigen.current = null
                  setOrigen(null)
                  setPrevia(null)
                }}
              >
                Otra foto
              </Boton>
              <Boton tipo="principal" ancho onClick={() => void guardar()} disabled={trabajando}>
                {trabajando ? 'Guardando…' : sceneId ? 'Reemplazar la foto' : 'Guardar habitación'}
              </Boton>
            </div>
          </>
        )}

        {!origen && (
          <Tarjeta>
            <p className="text-sm text-ink-200">
              ¿Prefieres que el visor arme la foto 360 solo?{' '}
              <button
                type="button"
                className="font-semibold text-brand-300 underline"
                onClick={() => ir({ nombre: 'capturar', tourId })}
              >
                Tómala con la cámara
              </button>
              .
            </p>
          </Tarjeta>
        )}
      </div>
    </Pantalla>
  )
}

function sugerirNombre(tour: StoredTour | null): string {
  const usados = new Set((tour?.scenes ?? []).map((s) => s.name.toLowerCase()))
  for (const nombre of ['Sala', 'Cocina', 'Comedor', 'Recámara', 'Baño', 'Patio', 'Cochera']) {
    if (!usados.has(nombre.toLowerCase())) return nombre
  }
  return `Habitación ${(tour?.scenes.length ?? 0) + 1}`
}

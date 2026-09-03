/* oxlint-disable react/set-state-in-effect -- El efecto sincroniza con la red,
   que es un sistema externo. */
import { useEffect, useState } from 'react'

import type { Ruta } from '../../lib/useHashRoute'
import {
  PublicarError,
  claveGuardada,
  despublicar,
  guardarClave,
  panelDeCasas,
  resumenDeVisitas,
  sePuedePublicar,
  type CasaPublicada,
  type Panel as DatosDelPanel,
  type ResumenDeVisitas,
} from '../../lib/publicar'
import { visitasRecientes } from '../../lib/metricas/resumen'
import { Aviso, Boton, Campo, Cargando, Hoja, Pantalla, Tarjeta } from './ui'
import { ResumenVisitas } from './Visitas'

export type PanelProps = { ir: (ruta: Ruta) => void }

const enMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`

const fecha = (ms: number | undefined) =>
  ms ? new Date(ms).toLocaleDateString('es-MX', { dateStyle: 'medium' }) : 'sin publicar'

/**
 * ============================================================================
 *  LAS CASAS PUBLICADAS DE UNA INMOBILIARIA
 * ============================================================================
 *
 * "Mis recorridos" es lo que vive en ESTE teléfono. Esto es lo que vive en el
 * servidor a nombre del código: las casas que publicó cualquier teléfono de la
 * inmobiliaria, con su link, sus visitas y su baja. Es el panel del inquilino
 * que el plan colgaba del `tenantId`, y el `tenantId` es el código.
 *
 * Pide el mismo código que publicar, y lo guarda donde publicar lo guarda. Con
 * la clave maestra enseña todas las casas del servicio.
 *
 * Lo que NO hace, a propósito: no edita. Editar una casa es editar el recorrido
 * que vive en el teléfono que la publicó; desde aquí se comparte, se miran las
 * visitas y se da de baja, que es lo que hace falta desde otro teléfono.
 */
export function Panel({ ir }: PanelProps) {
  const [codigo, setCodigo] = useState(claveGuardada())
  const [escrito, setEscrito] = useState('')
  const [intento, setIntento] = useState(0)
  const [estado, setEstado] = useState<
    { fase: 'cargando' } | { fase: 'listo'; datos: DatosDelPanel } | { fase: 'error'; mensaje: string }
  >({ fase: 'cargando' })
  const [copiado, setCopiado] = useState<string | null>(null)
  const [bajando, setBajando] = useState<CasaPublicada | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [visitas, setVisitas] = useState<
    | null
    | { casa: CasaPublicada; estado: 'cargando' }
    | { casa: CasaPublicada; estado: 'listo'; resumen: ResumenDeVisitas; ultimos7: number }
    | { casa: CasaPublicada; estado: 'error'; mensaje: string }
  >(null)

  useEffect(() => {
    if (!codigo) return
    let vivo = true
    setEstado({ fase: 'cargando' })
    void (async () => {
      try {
        const datos = await panelDeCasas(codigo)
        if (vivo) setEstado({ fase: 'listo', datos })
      } catch (e) {
        if (!vivo) return
        setEstado({
          fase: 'error',
          mensaje:
            e instanceof PublicarError
              ? [e.message, e.consejo].filter(Boolean).join(' ')
              : 'No se pudo leer el panel.',
        })
      }
    })()
    return () => {
      vivo = false
    }
  }, [codigo, intento])

  const mensajeDe = (e: unknown, sino: string) =>
    e instanceof PublicarError ? [e.message, e.consejo].filter(Boolean).join(' ') : sino

  const copiar = async (casa: CasaPublicada) => {
    try {
      await navigator.clipboard.writeText(casa.url)
      setCopiado(casa.llave)
      window.setTimeout(() => setCopiado(null), 2000)
    } catch {
      /* Safari solo deja copiar desde un gesto y con permiso; el link sigue a
         la vista para copiarlo a mano. */
    }
  }

  const verVisitas = async (casa: CasaPublicada) => {
    setVisitas({ casa, estado: 'cargando' })
    try {
      const resumen = await resumenDeVisitas(casa.llave, codigo)
      setVisitas({ casa, estado: 'listo', resumen, ultimos7: visitasRecientes(resumen.porDia, Date.now()) })
    } catch (e) {
      setVisitas({ casa, estado: 'error', mensaje: mensajeDe(e, 'No se pudieron leer las visitas.') })
    }
  }

  const bajar = async (casa: CasaPublicada) => {
    setOcupado(true)
    try {
      /* Sin código de rescate: el código de la inmobiliaria da de baja sus
         casas, que es exactamente para lo que existe este panel cuando el
         teléfono que publicó ya no está. */
      await despublicar(casa.llave, codigo)
      setBajando(null)
      setIntento((n) => n + 1)
    } catch (e) {
      setEstado({ fase: 'error', mensaje: mensajeDe(e, 'No se pudo dar de baja.') })
      setBajando(null)
    } finally {
      setOcupado(false)
    }
  }

  if (!sePuedePublicar()) {
    return (
      <Pantalla titulo="Casas publicadas" atras={() => ir({ nombre: 'inicio' })}>
        <Aviso tono="error" titulo="Esta versión no publica">
          Este visor se compiló sin la dirección del servidor de casas publicadas. Ver la sección 14
          del README.
        </Aviso>
      </Pantalla>
    )
  }

  if (!codigo) {
    return (
      <Pantalla titulo="Casas publicadas" atras={() => ir({ nombre: 'inicio' })}>
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          <p className="text-sm text-ink-200">
            Las casas que tu inmobiliaria publicó por link, desde cualquier teléfono. Escribe el
            código de invitación (o la clave del servidor, si tú lo operas).
          </p>
          <Campo etiqueta="Código" valor={escrito} onChange={setEscrito} placeholder="El código que te dio tu inmobiliaria" />
          <Boton
            tipo="principal"
            ancho
            disabled={!escrito.trim()}
            onClick={() => {
              const c = escrito.trim()
              guardarClave(c)
              setCodigo(c)
            }}
          >
            Entrar
          </Boton>
        </div>
      </Pantalla>
    )
  }

  const quien = estado.fase === 'listo' ? estado.datos.quien : null
  const subtitulo =
    quien === null
      ? undefined
      : quien === 'admin'
        ? 'Todas las casas del servicio'
        : `${quien.nombre} · ${enMB(quien.uso.bytes)} de ${enMB(quien.cuotas.bytes)}`

  return (
    <Pantalla titulo="Casas publicadas" subtitulo={subtitulo} atras={() => ir({ nombre: 'inicio' })}>
      <div className="mx-auto flex w-full max-w-md flex-col gap-3">
        {estado.fase === 'cargando' && <Cargando texto="Leyendo las casas publicadas…" />}

        {estado.fase === 'error' && (
          <>
            <Aviso tono="error" titulo="No se pudo">
              {estado.mensaje}
            </Aviso>
            <Boton ancho onClick={() => setIntento((n) => n + 1)}>
              Volver a intentar
            </Boton>
          </>
        )}

        {estado.fase === 'listo' && estado.datos.casas.length === 0 && (
          <Aviso titulo="Todavía no hay casas publicadas">
            Publica una desde su recorrido: Enseñar por link → Publicar. Aparecerá aquí para
            cualquier teléfono con este código.
          </Aviso>
        )}

        {estado.fase === 'listo' &&
          estado.datos.casas.map((casa) => (
            <Tarjeta key={casa.llave}>
              <div className="flex gap-3">
                <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-black/40">
                  {casa.portada && <img src={casa.portada} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{casa.titulo}</p>
                  <p className="truncate text-xs text-ink-200">
                    {casa.precio ? `${casa.precio} · ` : ''}
                    {casa.habitaciones} {casa.habitaciones === 1 ? 'habitación' : 'habitaciones'} ·{' '}
                    {enMB(casa.bytes)}
                  </p>
                  <p className="text-xs text-ink-200/70">Publicada el {fecha(casa.publicadoEn)}</p>
                </div>
              </div>
              <p className="mt-3 rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs break-all text-ink-50 select-all">
                {casa.url}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Boton onClick={() => void copiar(casa)}>{copiado === casa.llave ? 'Copiado' : 'Copiar'}</Boton>
                <Boton onClick={() => void verVisitas(casa)}>Visitas</Boton>
                <Boton tipo="fantasma" onClick={() => setBajando(casa)}>
                  Dar de baja
                </Boton>
              </div>
            </Tarjeta>
          ))}

        <Boton
          tipo="fantasma"
          ancho
          onClick={() => {
            guardarClave('')
            setCodigo('')
            setEscrito('')
          }}
        >
          Cambiar de código
        </Boton>
      </div>

      {visitas && (
        <Hoja titulo={`Visitas · ${visitas.casa.titulo}`} onCerrar={() => setVisitas(null)}>
          {visitas.estado === 'cargando' && <Cargando texto="Sumando las visitas…" />}
          {visitas.estado === 'error' && (
            <Aviso tono="error" titulo="No se pudieron leer">
              {visitas.mensaje}
            </Aviso>
          )}
          {visitas.estado === 'listo' && (
            <ResumenVisitas resumen={visitas.resumen} ultimos7={visitas.ultimos7} nombres={visitas.casa.nombres} />
          )}
        </Hoja>
      )}

      {bajando && (
        <Hoja titulo="Dar de baja" onCerrar={() => setBajando(null)}>
          <p className="mb-4 text-sm text-ink-200">
            El link de <b className="text-ink-50">{bajando.titulo}</b> dejará de abrir y sus fotos se
            borrarán del servidor. El recorrido sigue en el teléfono que lo publicó.
          </p>
          <div className="flex flex-col gap-2">
            <Boton tipo="peligro" ancho disabled={ocupado} onClick={() => void bajar(bajando)}>
              {ocupado ? 'Dando de baja…' : 'Sí, dar de baja'}
            </Boton>
            <Boton tipo="fantasma" ancho onClick={() => setBajando(null)}>
              Cancelar
            </Boton>
          </div>
        </Hoja>
      )}
    </Pantalla>
  )
}

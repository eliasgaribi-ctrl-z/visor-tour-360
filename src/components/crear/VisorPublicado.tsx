/* oxlint-disable react/set-state-in-effect -- El efecto sincroniza con la red,
   que es un sistema externo. */
import { useEffect, useState } from 'react'

import type { Tour } from '../../lib/types'
import type { Ruta } from '../../lib/useHashRoute'
import { PublicarError, abrirPublicado } from '../../lib/publicar'
import { aparato } from '../../lib/dispositivo'
import { ConPortada } from '../tour/ConPortada'
import { Aviso, Boton, Cargando, Pantalla } from './ui'

export type VisorPublicadoProps = {
  llave: string
  ir: (ruta: Ruta) => void
}

/**
 * Abre una casa publicada, descargándola del servidor.
 *
 * Es el gemelo de `VisorGuardado`, con una diferencia que manda en todo lo
 * demás: aquí quien abre NO es el dueño del recorrido. Es un cliente al que le
 * pasaron un link por WhatsApp, probablemente con datos móviles y sin haber
 * visto esta app en su vida.
 *
 * Por eso las salidas de error no ofrecen "ver mis recorridos" —no tiene
 * ninguno, y mandarlo a una lista vacía es peor que no ofrecer nada— sino
 * volver a intentar, que es lo que de verdad arregla el fallo más probable:
 * quedarse sin señal a media descarga.
 *
 * Y por eso pasa por la PORTADA (`ConPortada`): el comprador que abre un link
 * es exactamente para quien se construyó —precio, metros y contacto antes del
 * 3D—, y hasta aquí la casa publicada abría directo en la foto, sin marca.
 *
 * `anchoTextura` va al abrir: el manifiesto trae una copia de 2048 px de cada
 * foto, y un teléfono modesto —que igual iba a encoger la de 4096— se baja esa,
 * que pesa la cuarta parte.
 */
export function VisorPublicado({ llave, ir }: VisorPublicadoProps) {
  const [estado, setEstado] = useState<
    { fase: 'cargando' } | { fase: 'listo'; tour: Tour } | { fase: 'error'; mensaje: string; consejo?: string }
  >({ fase: 'cargando' })
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let vivo = true
    setEstado({ fase: 'cargando' })
    void (async () => {
      try {
        const tour = await abrirPublicado(llave, { anchoTextura: aparato().anchoTextura })
        if (!vivo) return
        setEstado({ fase: 'listo', tour })
      } catch (e) {
        if (!vivo) return
        setEstado({
          fase: 'error',
          mensaje: e instanceof PublicarError ? e.message : 'No se pudo abrir el recorrido.',
          consejo: e instanceof PublicarError ? e.consejo : undefined,
        })
      }
    })()
    return () => {
      vivo = false
    }
  }, [llave, intento])

  if (estado.fase === 'cargando') {
    return (
      <Pantalla titulo="Recorrido">
        <Cargando texto="Descargando el recorrido…" />
      </Pantalla>
    )
  }

  if (estado.fase === 'error') {
    return (
      <Pantalla titulo="Recorrido">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          <Aviso tono="error" titulo="No se pudo abrir">
            {estado.mensaje}
            {estado.consejo ? ` ${estado.consejo}` : ''}
          </Aviso>
          <Boton tipo="principal" ancho onClick={() => setIntento((n) => n + 1)}>
            Volver a intentar
          </Boton>
          <Boton tipo="fantasma" ancho onClick={() => ir({ nombre: 'demo' })}>
            Ver el recorrido de ejemplo
          </Boton>
        </div>
      </Pantalla>
    )
  }

  return <ConPortada tour={estado.tour} />
}

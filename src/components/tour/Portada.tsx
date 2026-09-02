import type { Ficha, Marca } from '../../lib/types'

export type PortadaProps = {
  titulo: string
  subtitulo?: string
  ficha: Ficha
  marca?: Marca
  /** La miniatura de la primera habitación, como fondo. */
  fondo?: string
  onEntrar: () => void
  /** El botón de la esquina, igual que el del visor (editar, crear el mío…). */
  accion?: React.ReactNode
}

/**
 * ============================================================================
 *  LA PORTADA DE LA CASA
 * ============================================================================
 *
 * Lo primero que ve un comprador cuando le llega el link. Precio, metros,
 * recámaras, dirección, y un botón para entrar al recorrido.
 *
 * ── Por qué no es solo decoración ──────────────────────────────────────────
 *
 * 1. **Es la pantalla que decide.** Un link que abre directo a una foto 360 sin
 *    contexto no dice de qué casa se trata ni cuánto cuesta. El recorrido es
 *    para quien ya se interesó; la portada es lo que crea el interés.
 *
 * 2. **Monta SIN WebGL**, y eso es lo que la hace valiosa en un teléfono viejo.
 *    El visor 3D necesita WebGL 2, que llegó a Safari en la 15: hoy, en un
 *    iPhone con iOS 13 o 14, lo único que se ve es el mensaje de `ViewerGuard`
 *    explicando que no se puede. Con portada, al menos ve la casa, el precio y
 *    el botón para llamar al agente. Deja de ser una pared y pasa a ser un
 *    anuncio.
 *
 * 3. **Da algo que pintar mientras baja el motor 3D.** El chunk del visor son
 *    ~1.1 MB entre three.js y React Three Fiber. Antes esa espera era un texto
 *    que decía "Abriendo…"; ahora es la ficha de la casa, que es justo lo que la
 *    persona quiere leer. Y quien la muestra dispara la descarga en paralelo
 *    (ver `precargarVisor` en VisorGuardado), así que leer no cuesta tiempo:
 *    cuando toca "Entrar", el motor ya está.
 *
 * No lleva ruta propia: es un estado del visor, no una pantalla aparte. Un
 * recorrido sin `ficha` no la muestra — una portada vacía es peor que ninguna.
 */
export function Portada({
  titulo,
  subtitulo,
  ficha,
  marca,
  fondo,
  onEntrar,
  accion,
}: PortadaProps) {
  const datos = [
    ficha.superficie && { que: 'Superficie', valor: ficha.superficie },
    ficha.recamaras !== undefined && {
      que: ficha.recamaras === 1 ? 'Recámara' : 'Recámaras',
      valor: String(ficha.recamaras),
    },
    ficha.banos !== undefined && {
      que: ficha.banos === 1 ? 'Baño' : 'Baños',
      valor: String(ficha.banos),
    },
  ].filter(Boolean) as { que: string; valor: string }[]

  const agente = ficha.agente

  return (
    <div className="alto-pantalla relative flex w-full flex-col overflow-y-auto">
      {/* El fondo es la miniatura de la primera habitación, ya cargada para la
          lista de recorridos: no cuesta una descarga nueva. Un <img> y no un
          background-image, para que el navegador lo priorice como contenido. */}
      {fondo && (
        <img
          src={fondo}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35"
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-black/70 to-black/90" />

      {accion && (
        <div
          className="relative z-10 flex justify-end px-4"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
        >
          {accion}
        </div>
      )}

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-end gap-5 p-5">
        {marca?.nombre && (
          <div className="flex items-center gap-2">
            {marca.logo && <img src={marca.logo} alt="" className="h-8 w-auto max-w-[9rem] object-contain" />}
            <span className="text-xs font-semibold uppercase tracking-widest text-ink-200">
              {marca.nombre}
            </span>
          </div>
        )}

        <div>
          {ficha.precio && (
            <p className="text-3xl font-bold leading-tight text-ink-50">{ficha.precio}</p>
          )}
          <h1 className="mt-1 text-xl font-semibold text-ink-50">{titulo}</h1>
          {ficha.direccion ? (
            <p className="mt-1 text-sm text-ink-200">{ficha.direccion}</p>
          ) : (
            subtitulo && <p className="mt-1 text-sm text-ink-200">{subtitulo}</p>
          )}
        </div>

        {datos.length > 0 && (
          <dl className="hud-glass grid grid-cols-3 gap-2 rounded-hud p-3 text-center">
            {datos.map((d) => (
              <div key={d.que}>
                <dt className="text-[11px] uppercase tracking-wide text-ink-200">{d.que}</dt>
                <dd className="text-base font-semibold text-ink-50">{d.valor}</dd>
              </div>
            ))}
          </dl>
        )}

        {ficha.descripcion && (
          <p className="text-sm leading-relaxed text-ink-200">{ficha.descripcion}</p>
        )}

        <div
          className="flex flex-col gap-2"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          <button
            type="button"
            onClick={onEntrar}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-hud
                       bg-brand-500 text-base font-semibold text-[var(--tinta-marca,#000)]
                       active:bg-brand-600"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="9" />
              <path d="M3.5 12h17M12 3.2a15 15 0 010 17.6M12 3.2a15 15 0 000 17.6" />
            </svg>
            Ver el recorrido
          </button>

          {/* El contacto va en la portada y no dentro del visor a propósito: en
              el recorrido el dedo está mirando alrededor, y un botón de llamar
              ahí se toca sin querer. Aquí es donde la persona decide. */}
          {agente && (agente.whatsapp || agente.telefono || agente.correo) && (
            <div className="flex gap-2">
              {agente.whatsapp && (
                <a
                  href={`https://wa.me/${agente.whatsapp}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hud-glass flex min-h-12 flex-1 items-center justify-center rounded-hud
                             text-sm font-semibold text-ink-50 active:bg-white/15"
                >
                  WhatsApp
                </a>
              )}
              {agente.telefono && (
                <a
                  href={`tel:${agente.telefono}`}
                  className="hud-glass flex min-h-12 flex-1 items-center justify-center rounded-hud
                             text-sm font-semibold text-ink-50 active:bg-white/15"
                >
                  Llamar
                </a>
              )}
              {agente.correo && (
                <a
                  href={`mailto:${agente.correo}`}
                  className="hud-glass flex min-h-12 flex-1 items-center justify-center rounded-hud
                             text-sm font-semibold text-ink-50 active:bg-white/15"
                >
                  Correo
                </a>
              )}
            </div>
          )}

          {agente?.nombre && (
            <p className="text-center text-xs text-ink-200">{agente.nombre}</p>
          )}
        </div>
      </div>
    </div>
  )
}

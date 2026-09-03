export type InfoSheetProps = {
  title: string
  body?: string
  onClose: () => void
}

/** Hoja inferior estilo app móvil para los hotspots informativos. */
export function InfoSheet({ title, body, onClose }: InfoSheetProps) {
  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-50 flex justify-center p-3
                    pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      {/* Los huecos que quedan a los lados de la hoja (y el respiro del padding)
          ya se tragaban el dedo sin hacer nada, porque el contenedor entero es
          pointer-events-auto: ahora al menos cierran.

          El fondo cubre SOLO esa franja de abajo, no la escena completa: un
          fondo a pantalla entera se comería el arrastre para mirar alrededor,
          que es el gesto principal del visor. Y no lleva nombre a propósito,
          para no tener dos controles "Cerrar" en el mismo sitio. */}
      <div aria-hidden onClick={onClose} className="absolute inset-0" />
      <div className="hud-glass relative w-full max-w-md rounded-hud p-4">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-hud">{title}</h2>
            {body && <p className="mt-1 text-sm leading-relaxed text-hud-2">{body}</p>}
          </div>
          {/* 44×44 y no 32×32: es la única salida de la hoja y está pegada al
              borde derecho, donde el pulgar llega con menos puntería. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-xl
                       leading-none text-hud active:bg-white/20"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}

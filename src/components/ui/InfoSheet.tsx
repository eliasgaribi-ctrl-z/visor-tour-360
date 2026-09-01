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
      <div className="hud-glass w-full max-w-md rounded-hud p-4">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink-50">{title}</h2>
            {body && <p className="mt-1 text-sm leading-relaxed text-ink-200">{body}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-ink-50 active:bg-white/20"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}

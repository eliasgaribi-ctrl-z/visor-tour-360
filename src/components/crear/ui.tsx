import type { ReactNode } from 'react'

/**
 * Piezas compartidas de las pantallas de creación.
 *
 * Nada sofisticado a propósito: en el celular lo único que importa es que todo
 * lo que se toca mida al menos 44 px y que nada quede debajo del notch ni de la
 * barra de gestos.
 */

export function Pantalla({
  titulo,
  subtitulo,
  atras,
  accion,
  children,
}: {
  titulo: string
  subtitulo?: string
  atras?: () => void
  accion?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-[100dvh] w-full flex-col bg-ink-900 text-ink-50">
      <header
        className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 py-3
                   pt-[calc(env(safe-area-inset-top)+0.75rem)]"
      >
        {atras && (
          <button
            type="button"
            onClick={atras}
            aria-label="Regresar"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 active:bg-white/20"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{titulo}</h1>
          {subtitulo && <p className="truncate text-xs text-ink-200">{subtitulo}</p>}
        </div>
        {accion}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-4">
        {children}
      </div>
    </div>
  )
}

type BotonProps = {
  children: ReactNode
  onClick?: () => void
  tipo?: 'principal' | 'normal' | 'peligro' | 'fantasma'
  disabled?: boolean
  ancho?: boolean
  icono?: ReactNode
  type?: 'button' | 'submit'
}

const ESTILOS: Record<NonNullable<BotonProps['tipo']>, string> = {
  principal: 'bg-brand-500 text-black active:bg-brand-600 disabled:bg-white/10 disabled:text-ink-200',
  normal: 'bg-white/10 text-ink-50 active:bg-white/20 disabled:text-ink-200/50',
  peligro: 'bg-red-500/15 text-red-300 active:bg-red-500/25',
  fantasma: 'text-ink-200 active:bg-white/10',
}

export function Boton({
  children,
  onClick,
  tipo = 'normal',
  disabled,
  ancho,
  icono,
  type = 'button',
}: BotonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold
                  transition-colors disabled:cursor-not-allowed ${ESTILOS[tipo]} ${ancho ? 'w-full' : ''}`}
    >
      {icono}
      {children}
    </button>
  )
}

export function Tarjeta({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  const clases =
    'w-full rounded-hud border border-white/10 bg-white/5 p-4 text-left transition-colors'
  return onClick ? (
    <button type="button" onClick={onClick} className={`${clases} active:bg-white/10`}>
      {children}
    </button>
  ) : (
    <div className={clases}>{children}</div>
  )
}

export function Campo({
  etiqueta,
  valor,
  onChange,
  placeholder,
  ayuda,
  multilinea,
  maxLength,
}: {
  etiqueta: string
  valor: string
  onChange: (valor: string) => void
  placeholder?: string
  ayuda?: string
  multilinea?: boolean
  maxLength?: number
}) {
  const clases =
    'w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-ink-50 outline-none placeholder:text-ink-200/50 focus:border-brand-500'
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-200">{etiqueta}</span>
      {multilinea ? (
        <textarea
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={3}
          className={clases}
        />
      ) : (
        <input
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className={clases}
        />
      )}
      {ayuda && <span className="mt-1.5 block text-xs text-ink-200/70">{ayuda}</span>}
    </label>
  )
}

export function Aviso({
  tono = 'info',
  titulo,
  children,
  accion,
}: {
  tono?: 'info' | 'alerta' | 'error'
  titulo?: string
  children: ReactNode
  accion?: ReactNode
}) {
  const tonos = {
    info: 'border-white/10 bg-white/5 text-ink-200',
    alerta: 'border-brand-500/30 bg-brand-500/10 text-brand-300',
    error: 'border-red-500/30 bg-red-500/10 text-red-200',
  }
  return (
    <div className={`rounded-2xl border p-3.5 text-sm leading-relaxed ${tonos[tono]}`}>
      {titulo && <p className="mb-1 font-semibold">{titulo}</p>}
      <div>{children}</div>
      {accion && <div className="mt-3">{accion}</div>}
    </div>
  )
}

export function Cargando({ texto = 'Un momento…' }: { texto?: string }) {
  return (
    <div className="grid place-items-center gap-3 py-16 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-brand-500" />
      <p className="text-sm text-ink-200">{texto}</p>
    </div>
  )
}

/** Hoja inferior para confirmaciones y formularios cortos. */
export function Hoja({
  titulo,
  onCerrar,
  children,
}: {
  titulo: string
  onCerrar: () => void
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      {/* El fondo cierra la hoja al tocarlo, pero NO es un botón con nombre:
          tener dos controles llamados "Cerrar" confunde a un lector de pantalla
          y a cualquiera que navegue con teclado. La × de adentro es la que
          cuenta. */}
      <div aria-hidden onClick={onCerrar} className="absolute inset-0" />
      {/* max-h + scroll: la hoja de editar un punto pasa de 500 px de alto, y
          en un teléfono chico con el teclado abierto no cabe. Sin esto, el
          botón de guardar queda fuera de la pantalla y no hay forma de llegar. */}
      <div className="hud-glass relative max-h-[85dvh] w-full max-w-md overflow-y-auto
                      overscroll-contain rounded-hud p-4">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink-50">{titulo}</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-ink-50 active:bg-white/20"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

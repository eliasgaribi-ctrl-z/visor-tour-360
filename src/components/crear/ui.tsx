import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

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
    <div className="alto-pantalla flex w-full flex-col bg-ink-900 text-ink-50">
      <header
        className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 py-3
                   pt-[calc(env(safe-area-inset-top)+0.75rem)]"
      >
        {atras && (
          <button
            type="button"
            onClick={atras}
            aria-label="Regresar"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 active:bg-white/20"
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
    /* data-cargando lo lee la red de seguridad de index.html: sin esta marca,
       "#root tiene hijos" significaba "montó bien", y el velo de espera del
       Suspense es un hijo, así que la red se auto-descartaba siempre. */
    <div data-cargando="1" className="grid place-items-center gap-3 py-16 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-brand-500" />
      <p className="text-sm text-ink-200">{texto}</p>
    </div>
  )
}

/* Lo que se puede enfocar dentro de la hoja. Es la lista de siempre; el filtro
   de `disabled` va aparte porque un botón deshabilitado sí aparece en el
   querySelector pero el navegador no lo enfoca, y si lo tomáramos como el
   último de la fila el Tab se quedaría atorado en el vacío. */
const ENFOCABLES =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

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
  const idTitulo = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [altoVisible, setAltoVisible] = useState<number | null>(null)

  /* Foco al abrir y devuelto al cerrar. Sin esto, quien navega con teclado o
     con lector de pantalla abre la hoja y el foco se queda donde estaba: en el
     botón de atrás de la pantalla que quedó debajo. Anunciaba la hoja como si
     no existiera y había que tabular a ciegas hasta encontrarla. Al cerrar, el
     foco vuelve al botón que la abrió, que es donde la persona iba. */
  useEffect(() => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.focus()
    return () => {
      previo?.focus()
    }
  }, [])

  /* El teclado de iOS no encoge la ventana: la tapa. La hoja está anclada
     abajo, así que con el teclado abierto el botón de guardar queda literalmente
     debajo de las teclas. Lo que sí sabe dónde termina la parte visible es
     visualViewport, así que la altura de la hoja se acota a esa medida.

     Se acota la ALTURA y no se le mete paddingBottom al contenedor: en iOS los
     elementos `fixed` se reposicionan solos contra el viewport visual cuando
     sale el teclado, y el padding se sumaría a ese corrimiento; la hoja se iría
     hacia arriba el doble de lo que debe. Los 24 px que se restan son el p-3 de
     arriba y abajo del contenedor. */
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const medir = () => setAltoVisible(vv.height)
    medir()
    vv.addEventListener('resize', medir)
    vv.addEventListener('scroll', medir)
    return () => {
      vv.removeEventListener('resize', medir)
      vv.removeEventListener('scroll', medir)
    }
  }, [])

  /* Escape cierra, y el Tab da vueltas dentro de la hoja en vez de irse a los
     controles de la pantalla de atrás, que están tapados y no se pueden usar. */
  const alTeclear = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === 'Escape') {
      evento.stopPropagation()
      onCerrar()
      return
    }
    if (evento.key !== 'Tab') return
    const caja = panel.current
    if (!caja) return
    const focos = Array.from(caja.querySelectorAll<HTMLElement>(ENFOCABLES)).filter(
      (el) => !el.hasAttribute('disabled'),
    )
    if (focos.length === 0) return
    const primero = focos[0]
    const ultimo = focos[focos.length - 1]
    const activo = document.activeElement
    /* El panel mismo cuenta como "antes del primero": recién abierto, el foco
       está en él, y un Shift+Tab desde ahí se saldría de la hoja. */
    if (evento.shiftKey && (activo === primero || activo === caja)) {
      evento.preventDefault()
      ultimo.focus()
    } else if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault()
      primero.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      {/* El fondo cierra la hoja al tocarlo, pero NO es un botón con nombre:
          tener dos controles llamados "Cerrar" confunde a un lector de pantalla
          y a cualquiera que navegue con teclado. La × de adentro es la que
          cuenta. */}
      <div aria-hidden onClick={onCerrar} className="absolute inset-0" />
      {/* El diálogo es este panel y no el `fixed inset-0` de arriba: si el rol
          fuera del contenedor, el fondo que cierra quedaría dentro del diálogo y
          un lector de pantalla lo leería como parte del contenido.

          Lo que NO se hace es marcar la pantalla de atrás con aria-hidden: las
          ocho hojas se renderizan DENTRO de <Pantalla>, así que esconder ese
          contenedor escondería también la hoja. Para inertizar el fondo de
          verdad habría que sacar la hoja a un portal. */}
      {/* max-h + scroll: la hoja de editar un punto pasa de 500 px de alto, y
          en un teléfono chico con el teclado abierto no cabe. Sin esto, el
          botón de guardar queda fuera de la pantalla y no hay forma de llegar.
          alto-max-hoja se queda de respaldo para los navegadores sin
          visualViewport. */}
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        onKeyDown={alTeclear}
        style={altoVisible ? { maxHeight: altoVisible - 24 } : undefined}
        className="hud-glass alto-max-hoja relative w-full max-w-md overflow-y-auto
                   overscroll-contain rounded-hud p-4 outline-none"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={idTitulo} className="text-base font-semibold text-ink-50">
            {titulo}
          </h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-xl
                       leading-none text-ink-50 active:bg-white/20"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

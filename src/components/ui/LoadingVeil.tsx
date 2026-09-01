export function LoadingVeil({ visible, label = 'Cargando panorámica…' }: { visible: boolean; label?: string }) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 grid place-items-center bg-black/70 transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden={!visible}
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-brand-500" />
        <p className="text-sm text-ink-200">{label}</p>
      </div>
    </div>
  )
}

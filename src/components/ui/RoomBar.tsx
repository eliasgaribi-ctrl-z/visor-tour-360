import type { TourScene } from '../../lib/types'

export type RoomBarProps = {
  scenes: TourScene[]
  activeId: string
  onSelect: (sceneId: string) => void
}

/** Selector de habitaciones. Scroll horizontal, cómodo para el pulgar derecho. */
export function RoomBar({ scenes, activeId, onSelect }: RoomBarProps) {
  return (
    <div
      /* La barra se desplaza a lo ancho, y el zoom de la rueda ahora también
         escucha en la capa del HUD: sin esto, rodar la rueda aquí correría la
         lista Y haría zoom en la foto al mismo tiempo. */
      onWheel={(evento) => evento.stopPropagation()}
      className="pointer-events-auto flex w-fit max-w-full gap-2 overflow-x-auto rounded-hud p-2
                 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden hud-glass"
    >
      {scenes.map((scene) => {
        const isActive = scene.id === activeId
        return (
          <button
            key={scene.id}
            type="button"
            onClick={() => onSelect(scene.id)}
            aria-current={isActive}
            /* min-h-11 = 44 px: el mínimo cómodo para un pulgar. Es el
               control que más se toca de todo el visor y estaba en 36. */
            /* inline-flex + items-center: con `min-h` a secas el texto se
               quedaría pegado arriba en vez de centrado. */
            className={`relative inline-flex min-h-11 shrink-0 items-center overflow-hidden rounded-xl
                        px-4 text-sm font-medium whitespace-nowrap transition-colors ${
                          isActive
                            /* La tinta la deriva `aplicarMarca` de la luminancia del
                               acento, igual que en los botones: con un morado o un azul
                               marino de marca, `text-black` fijo se pierde encima. El
                               default de la variable deja el ámbar de THIQA como hoy. */
                            ? 'bg-brand-500 text-[var(--tinta-marca,#000)]'
                            : 'bg-white/10 text-hud active:bg-white/20'
                        }`}
          >
            {scene.thumbnail && (
              <img
                src={scene.thumbnail}
                alt=""
                aria-hidden
                className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
                  isActive ? 'opacity-25' : 'opacity-35'
                }`}
              />
            )}
            <span className="relative drop-shadow">{scene.name}</span>
          </button>
        )
      })}
    </div>
  )
}

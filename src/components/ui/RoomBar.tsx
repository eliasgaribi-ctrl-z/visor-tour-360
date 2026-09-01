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
            className={`relative shrink-0 overflow-hidden rounded-xl px-3.5 py-2 text-sm font-medium
                        whitespace-nowrap transition-colors ${
                          isActive
                            ? 'bg-brand-500 text-black'
                            : 'bg-white/10 text-ink-50 active:bg-white/20'
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

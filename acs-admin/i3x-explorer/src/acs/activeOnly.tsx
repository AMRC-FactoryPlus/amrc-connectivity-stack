// ACS: "Active only" in the subscriptions panel hides the rows still waiting
// for their first update, so a composition with many quiet metrics shows the
// ones that are moving. Off by default; kept for the browser session.

import { create } from 'zustand'

const KEY = 'i3x-subscriptions-active-only'

function initial(): boolean {
  try {
    return sessionStorage.getItem(KEY) === 'true'
  } catch {
    return false
  }
}

export const useActiveOnly = create<{ activeOnly: boolean; setActiveOnly: (on: boolean) => void }>(set => ({
  activeOnly: initial(),
  setActiveOnly: on => {
    try {
      sessionStorage.setItem(KEY, String(on))
    } catch {
      // Kept in memory only.
    }
    set({ activeOnly: on })
  },
}))

interface Row { elementId: string; isComponent: boolean; rootId: string }

/**
 * The rows to show. With `activeOnly`, a row shows once its element has had an
 * update; a composition's own row shows while any of its listed components is
 * active, so the active components keep their heading.
 */
export function visibleRows<T extends Row>(rows: T[], activeOnly: boolean, isActive: (elementId: string) => boolean): T[] {
  if (!activeOnly) return rows
  const activeRoots = new Set<string>()
  for (const row of rows) {
    if (row.isComponent && isActive(row.elementId)) activeRoots.add(row.rootId)
  }
  return rows.filter(row =>
    isActive(row.elementId) || (!row.isComponent && activeRoots.has(row.rootId)))
}

/** The switch, for the panel header. */
export function ActiveOnlyToggle() {
  const activeOnly = useActiveOnly(state => state.activeOnly)
  const setActiveOnly = useActiveOnly(state => state.setActiveOnly)
  return (
    <label
      className="flex items-center gap-1.5 text-[11px] text-i3x-text-muted whitespace-nowrap cursor-pointer select-none"
      title="Hide rows still waiting for their first update"
    >
      <button
        type="button"
        role="switch"
        aria-checked={activeOnly}
        aria-label="Only show active"
        onClick={() => setActiveOnly(!activeOnly)}
        className={`relative h-3.5 w-6 rounded-full transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary ${
          activeOnly ? 'bg-i3x-primary' : 'bg-i3x-border'
        }`}
      >
        <span
          className={`absolute top-px left-px h-3 w-3 rounded-full bg-i3x-surface transition-transform motion-reduce:transition-none ${
            activeOnly ? 'translate-x-2.5' : ''
          }`}
        />
      </button>
      Only show active
    </label>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { downsampleMinMax, useTrendWindow, windowRange } from '../../acs/trendBuffer'

const MIN_WIDTH = 72
const HEIGHT = 18
const PAD = 2

/**
 * A tiny trend of an element's values, sized to sit in a table cell.
 * ACS: it fills the room left in its cell (at least 72px), measured as the
 * cell resizes, and shows the same window as the trend graphs (All, 30 s, …
 * or the last N readings) on the same time axis, reduced to its pixel width.
 */
export function Sparkline({ elementId }: { elementId: string }) {
  const series = useSubscriptionsStore(state => state.trendData.get(elementId))
  const trendWindow = useTrendWindow(state => state.window)
  const box = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState(MIN_WIDTH)

  useEffect(() => {
    const el = box.current
    // The element's own window, so this works in the popped-out panel too.
    const Observer = el?.ownerDocument.defaultView?.ResizeObserver
    if (!el || !Observer) return
    const observer = new Observer(entries => {
      const w = Math.floor(entries[0].contentRect.width)
      setWidth(Math.max(MIN_WIDTH, w))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const range = series ? windowRange(series.buffer, trendWindow, Date.now()) : null
  const drawn = series && range && range.to - range.from >= 2
    ? downsampleMinMax(series.buffer, range, width - 2 * PAD)
    : null

  let line: string | null = null
  let last: [number, number] | null = null
  if (drawn && range && drawn.times.length >= 2) {
    const yRange = drawn.yMax - drawn.yMin || 1
    const span = range.tEnd - range.tStart || 1
    const coords = drawn.times.map((t, i): [number, number] => [
      PAD + Math.max(0, (t - range.tStart) / span) * (width - 2 * PAD),
      PAD + (1 - (drawn.values[i] - drawn.yMin) / yRange) * (HEIGHT - 2 * PAD),
    ])
    line = coords.map(([x, y]) => `${x},${y}`).join(' ')
    last = coords[coords.length - 1]
  }

  return (
    <span ref={box} aria-hidden="true" className="block flex-1 min-w-[72px] h-[18px] text-i3x-success">
      {line && last && (
        <svg width={width} height={HEIGHT} className="block">
          <polyline
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={last[0]} cy={last[1]} r="2" fill="currentColor" />
        </svg>
      )}
    </span>
  )
}

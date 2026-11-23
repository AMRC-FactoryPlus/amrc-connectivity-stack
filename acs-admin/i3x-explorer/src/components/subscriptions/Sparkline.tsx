import { useSubscriptionsStore } from '../../stores/subscriptions'
import { downsampleMinMax, useTrendWindow, windowRange } from '../../acs/trendBuffer'

const WIDTH = 72
const HEIGHT = 18
const PAD = 2

/**
 * A tiny trend of an element's values, sized to sit in a table cell.
 * ACS: it shows the same window as the trend graphs (All, 30 s, … or the last
 * N readings), on the same time axis, drawn from the element's trend buffer and
 * reduced to its pixel width.
 */
export function Sparkline({ elementId }: { elementId: string }) {
  const series = useSubscriptionsStore(state => state.trendData.get(elementId))
  const trendWindow = useTrendWindow(state => state.window)
  if (!series) return null
  const range = windowRange(series.buffer, trendWindow, Date.now())
  if (!range || range.to - range.from < 2) return null

  const { times, values, yMin, yMax } = downsampleMinMax(series.buffer, range, WIDTH - 2 * PAD)
  if (times.length < 2) return null
  const yRange = yMax - yMin || 1
  const span = range.tEnd - range.tStart || 1
  const coords = times.map((t, i) => [
    PAD + Math.max(0, (t - range.tStart) / span) * (WIDTH - 2 * PAD),
    PAD + (1 - (values[i] - yMin) / yRange) * (HEIGHT - 2 * PAD),
  ])
  const [lastX, lastY] = coords[coords.length - 1]

  return (
    <svg width={WIDTH} height={HEIGHT} aria-hidden="true" className="flex-shrink-0 text-i3x-success">
      <polyline
        points={coords.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r="2" fill="currentColor" />
    </svg>
  )
}

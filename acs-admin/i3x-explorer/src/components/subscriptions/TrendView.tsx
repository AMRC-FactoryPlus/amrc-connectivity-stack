import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSubscriptionsStore } from '../../stores/subscriptions'
import { downsampleMinMax, useTrendWindow, windowRange } from '../../acs/trendBuffer' // ACS
import { useNow } from './liveTime' // ACS

// Colors, reference CSS variables so they respond to the active theme
const COLORS = {
  bg:        'rgb(var(--i3x-bg))',
  surface:   'rgb(var(--i3x-surface))',
  border:    'rgb(var(--i3x-border))',
  text:      'rgb(var(--i3x-text))',
  textMuted: 'rgb(var(--i3x-text-muted))',
  primary:   'rgb(var(--i3x-primary))',
  success:   'rgb(var(--i3x-success))',
  grid:      'rgb(var(--i3x-border))',
}

// Chart dimensions. ACS: the width is the container's, measured, so a graph fills its panel.
const FALLBACK_WIDTH = 400
const CHART_HEIGHT = 120
const PADDING = { top: 10, right: 10, bottom: 25, left: 50 }
const PLOT_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom

interface TrendViewProps {
  elementId: string
}

/**
 * ACS: the width of an element, kept up to date. Observed with the ResizeObserver of the window
 * the element is in, which is the pop-out window when the subscriptions panel is popped out.
 */
function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.clientWidth)
    const Observer = element.ownerDocument.defaultView?.ResizeObserver
    if (!Observer) return
    const observer = new Observer(entries => {
      const next = Math.round(entries[0]?.contentRect.width ?? element.clientWidth)
      setWidth(previous => (previous === next ? previous : next))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/**
 * ACS: a metric's trend over the window chosen in the panel header (All by default, from the
 * first reading to now), across the full width it is given. The readings are reduced to the
 * lowest and highest in each pixel column before drawing, so a long history draws quickly, and it
 * redraws when the element's trend changes, which the frame batcher limits to once a frame, or
 * once a second to move the time axis on when no readings arrive.
 */
export function TrendView({ elementId }: TrendViewProps) {
  const series = useSubscriptionsStore(state => state.trendData.get(elementId))
  const trendWindow = useTrendWindow(state => state.window)
  const tick = useNow()
  const containerRef = useRef<HTMLDivElement>(null)
  const measured = useElementWidth(containerRef)
  const chartWidth = measured > 0 ? measured : FALLBACK_WIDTH
  const plotWidth = Math.max(10, chartWidth - PADDING.left - PADDING.right)

  const chart = useMemo(() => {
    if (!series || series.buffer.length < 2) return null
    const range = windowRange(series.buffer, trendWindow, Date.now())
    if (!range || range.to - range.from < 1) return null
    const { times, values, yMin: low, yMax: high } = downsampleMinMax(series.buffer, range, plotWidth)

    // Add some padding to the range
    const spread = high - low || 1
    const yMin = low - spread * 0.1
    const yMax = high + spread * 0.1
    const yTicks: number[] = []
    for (let i = 0; i <= 4; i++) yTicks.push(yMin + (yMax - yMin) * (i / 4))

    const timeRange = range.tEnd - range.tStart
    const xOf = (t: number) => PADDING.left + ((t - range.tStart) / timeRange) * plotWidth
    const yOf = (v: number) => PADDING.top + PLOT_HEIGHT - ((v - yMin) / (yMax - yMin)) * PLOT_HEIGHT
    let path = ''
    for (let i = 0; i < times.length; i++) {
      path += `${i === 0 ? 'M' : 'L'}${xOf(times[i]).toFixed(1)} ${yOf(values[i]).toFixed(1)}`
    }
    const last = times.length - 1
    return {
      path,
      yTicks: yTicks.map(tick => ({ y: yOf(tick), label: formatValue(tick) })),
      startLabel: formatTime(range.tStart),
      endLabel: formatTime(range.tEnd),
      lastPoint: { x: xOf(times[last]), y: yOf(values[last]) },
    }
    // `tick` moves the axis on once a second when no readings arrive.
  }, [series, trendWindow, plotWidth, tick])

  return (
    <div ref={containerRef} data-trend-view="" className="relative w-full min-w-0" style={{ height: CHART_HEIGHT }}>
      {!chart ? (
        <div
          className="absolute inset-0 flex items-center justify-center text-xs"
          style={{ backgroundColor: COLORS.surface, borderRadius: '6px', color: COLORS.textMuted }}
        >
          {series && series.buffer.length >= 2 ? 'No readings in this window' : 'Waiting for data...'}
        </div>
      ) : (
        // Absolutely placed, so the graph's width never props its table cell open.
        <svg
          width={chartWidth}
          height={CHART_HEIGHT}
          className="absolute inset-0"
          style={{ backgroundColor: COLORS.surface, borderRadius: '6px' }}
        >
          {chart.yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={PADDING.left}
                y1={tick.y}
                x2={PADDING.left + plotWidth}
                y2={tick.y}
                stroke={COLORS.grid}
                strokeWidth="1"
                strokeDasharray="2,2"
              />
              <text x={PADDING.left - 5} y={tick.y + 3} textAnchor="end" fill={COLORS.textMuted} fontSize="9" className="tabular-nums">
                {tick.label}
              </text>
            </g>
          ))}

          <text x={PADDING.left} y={CHART_HEIGHT - 5} textAnchor="start" fill={COLORS.textMuted} fontSize="9" className="tabular-nums">
            {chart.startLabel}
          </text>
          <text x={PADDING.left + plotWidth} y={CHART_HEIGHT - 5} textAnchor="end" fill={COLORS.textMuted} fontSize="9" className="tabular-nums">
            {chart.endLabel}
          </text>

          <path
            d={chart.path}
            fill="none"
            stroke={COLORS.success}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <circle cx={chart.lastPoint.x} cy={chart.lastPoint.y} r="4" fill={COLORS.success} />
        </svg>
      )}
    </div>
  )
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toFixed(0)
  } else if (Math.abs(value) >= 1) {
    return value.toFixed(1)
  } else {
    return value.toFixed(2)
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

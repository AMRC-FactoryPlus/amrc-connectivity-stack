/*
 * ACS Admin
 * A subscribed metric's whole trend, kept compactly, and the window a graph shows of it
 * Copyright 2026 University of Sheffield
 *
 * Upstream kept the last 60 readings as an array of objects, so a feed of 100 updates a second
 * showed one second of history and the graph raced. This keeps every reading since subscribing,
 * up to an hour or 50,000 readings per element, whichever comes first, dropping the oldest. The
 * readings sit in two parallel Float64Arrays used as a ring, 16 bytes a reading, so 30 metrics at
 * 100 Hz for the full cap is about 24 MB.
 */

import { create } from 'zustand'

export const TREND_MAX_POINTS = 50_000
export const TREND_MAX_AGE_MS = 60 * 60 * 1000
const INITIAL_CAPACITY = 256

export interface TrendPoint {
  value: number
  timestamp: number // ms since epoch
}

/** One element's readings, oldest first, in a ring that grows to its cap. */
export class TrendBuffer {
  readonly maxPoints: number
  readonly maxAgeMs: number
  private times: Float64Array
  private values: Float64Array
  private head = 0
  private count = 0
  /** Bumped on every push, so a reader can tell the buffer changed. */
  revision = 0
  /** When the newest reading arrived here (ms since epoch), to place "now" on its time axis. */
  lastReceivedAt = 0

  constructor(maxPoints = TREND_MAX_POINTS, maxAgeMs = TREND_MAX_AGE_MS) {
    this.maxPoints = maxPoints
    this.maxAgeMs = maxAgeMs
    const capacity = Math.min(INITIAL_CAPACITY, maxPoints)
    this.times = new Float64Array(capacity)
    this.values = new Float64Array(capacity)
  }

  get length(): number {
    return this.count
  }

  push(timestamp: number, value: number, receivedAt = timestamp): void {
    if (this.count === this.times.length) {
      if (this.times.length < this.maxPoints) this.grow()
      else this.dropOldest()
    }
    const slot = (this.head + this.count) % this.times.length
    this.times[slot] = timestamp
    this.values[slot] = value
    this.count++
    while (this.count > 1 && timestamp - this.timeAt(0) > this.maxAgeMs) this.dropOldest()
    this.lastReceivedAt = receivedAt
    this.revision++
  }

  timeAt(index: number): number {
    return this.times[(this.head + index) % this.times.length]
  }

  valueAt(index: number): number {
    return this.values[(this.head + index) % this.times.length]
  }

  /** The index of the first reading at or after `time`; `length` when there is none. */
  lowerBound(time: number): number {
    let low = 0
    let high = this.count
    while (low < high) {
      const mid = (low + high) >>> 1
      if (this.timeAt(mid) < time) low = mid + 1
      else high = mid
    }
    return low
  }

  /** The readings from `from` (default all) as objects, for tests and small views. */
  toArray(from = 0): TrendPoint[] {
    const points: TrendPoint[] = []
    for (let i = Math.max(0, from); i < this.count; i++) {
      points.push({ value: this.valueAt(i), timestamp: this.timeAt(i) })
    }
    return points
  }

  private dropOldest(): void {
    this.head = (this.head + 1) % this.times.length
    this.count--
  }

  private grow(): void {
    const capacity = Math.min(this.maxPoints, this.times.length * 2)
    const times = new Float64Array(capacity)
    const values = new Float64Array(capacity)
    for (let i = 0; i < this.count; i++) {
      times[i] = this.timeAt(i)
      values[i] = this.valueAt(i)
    }
    this.times = times
    this.values = values
    this.head = 0
  }
}

/**
 * What the store holds per element: the buffer, which is appended to in place, and the revision
 * it was at. A new one is stored on each write, so a graph re-renders when its own trend moves.
 */
export interface TrendSeries {
  readonly buffer: TrendBuffer
  readonly revision: number
}

/** How much of each trend the graphs show. */
export type TrendWindow =
  | { kind: 'all' }
  | { kind: 'seconds'; seconds: number }
  | { kind: 'points'; count: number }

export const TREND_WINDOW_CHOICES: ReadonlyArray<{ label: string; window: TrendWindow }> = [
  { label: 'All', window: { kind: 'all' } },
  { label: '30 s', window: { kind: 'seconds', seconds: 30 } },
  { label: '1 min', window: { kind: 'seconds', seconds: 60 } },
  { label: '5 min', window: { kind: 'seconds', seconds: 300 } },
  { label: '15 min', window: { kind: 'seconds', seconds: 900 } },
  { label: '1 h', window: { kind: 'seconds', seconds: 3600 } },
]

export function sameWindow(a: TrendWindow, b: TrendWindow): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'seconds') return a.seconds === (b as { seconds: number }).seconds
  if (a.kind === 'points') return a.count === (b as { count: number }).count
  return true
}

/** The part of a buffer a graph shows: readings [from, to) on a time axis from tStart to tEnd. */
export interface WindowRange {
  from: number
  to: number
  tStart: number
  tEnd: number
}

/**
 * The readings a window shows and its time axis. The axis ends at "now" on the source clock: the
 * newest reading's time plus how long ago it arrived, so a server clock that is off doesn't push
 * the line off the graph. "All" starts at the first reading, so the line squashes as time goes on
 * rather than scrolling.
 */
export function windowRange(buffer: TrendBuffer, window: TrendWindow, now: number): WindowRange | null {
  const length = buffer.length
  if (length === 0) return null
  const lastTime = buffer.timeAt(length - 1)
  const tEnd = lastTime + Math.max(0, now - buffer.lastReceivedAt)
  let from = 0
  let tStart = buffer.timeAt(0)
  if (window.kind === 'seconds') {
    tStart = tEnd - window.seconds * 1000
    from = buffer.lowerBound(tStart)
  } else if (window.kind === 'points') {
    from = Math.max(0, length - Math.max(1, Math.floor(window.count)))
    tStart = buffer.timeAt(from)
  }
  if (tEnd <= tStart) tStart = tEnd - 1
  return { from, to: length, tStart, tEnd }
}

export interface Downsampled {
  times: number[]
  values: number[]
  yMin: number
  yMax: number
}

/**
 * The readings to draw for a graph `columns` pixels wide: in each pixel column, its lowest and
 * highest reading in time order, so peaks survive and 50,000 readings draw as at most two points a
 * pixel. A window with fewer readings than that is drawn as it is.
 */
export function downsampleMinMax(
  buffer: TrendBuffer,
  range: WindowRange,
  columns: number
): Downsampled {
  const { from, to, tStart, tEnd } = range
  const times: number[] = []
  const values: number[] = []
  let yMin = Infinity
  let yMax = -Infinity
  const emit = (index: number) => {
    const value = buffer.valueAt(index)
    times.push(buffer.timeAt(index))
    values.push(value)
    if (value < yMin) yMin = value
    if (value > yMax) yMax = value
  }

  const cols = Math.max(1, Math.floor(columns))
  if (to - from <= cols * 2) {
    for (let i = from; i < to; i++) emit(i)
    return { times, values, yMin, yMax }
  }

  const span = tEnd - tStart
  let column = -1
  let minIndex = -1
  let maxIndex = -1
  const flush = () => {
    if (minIndex < 0) return
    if (minIndex === maxIndex) emit(minIndex)
    else if (minIndex < maxIndex) { emit(minIndex); emit(maxIndex) }
    else { emit(maxIndex); emit(minIndex) }
  }
  for (let i = from; i < to; i++) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor(((buffer.timeAt(i) - tStart) / span) * cols)))
    if (c !== column) {
      flush()
      column = c
      minIndex = i
      maxIndex = i
      continue
    }
    const value = buffer.valueAt(i)
    if (value < buffer.valueAt(minIndex)) minIndex = i
    if (value > buffer.valueAt(maxIndex)) maxIndex = i
  }
  flush()
  return { times, values, yMin, yMax }
}

const WINDOW_KEY = 'i3x-trend-window'

function initialWindow(): TrendWindow {
  try {
    const saved = JSON.parse(sessionStorage.getItem(WINDOW_KEY) ?? 'null') as TrendWindow | null
    if (saved?.kind === 'all') return saved
    if (saved?.kind === 'seconds' && saved.seconds > 0) return saved
    if (saved?.kind === 'points' && saved.count > 0) return saved
  } catch {
    // No session storage (a private window, or tests): start on All.
  }
  return { kind: 'all' }
}

/** The window every graph in the subscriptions panel shows, kept for the browser session. */
export const useTrendWindow = create<{ window: TrendWindow; setWindow: (window: TrendWindow) => void }>(set => ({
  window: initialWindow(),
  setWindow: window => {
    try {
      sessionStorage.setItem(WINDOW_KEY, JSON.stringify(window))
    } catch {
      // Kept in memory only.
    }
    set({ window })
  },
}))

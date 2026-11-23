/*
 * ACS Admin
 * Tests for the trend buffer, its windows and the downsampler
 * Copyright 2026 University of Sheffield
 */

import { describe, expect, it } from 'vitest'
import { downsampleMinMax, TrendBuffer, windowRange } from './trendBuffer'

function filled(count: number, maxPoints?: number, maxAgeMs?: number, stepMs = 10): TrendBuffer {
  const buffer = new TrendBuffer(maxPoints, maxAgeMs)
  for (let i = 0; i < count; i++) buffer.push(i * stepMs, i, i * stepMs)
  return buffer
}

describe('TrendBuffer', () => {
  it('keeps every reading below the caps, growing as it fills', () => {
    const buffer = filled(1_000)
    expect(buffer.length).toBe(1_000)
    expect(buffer.valueAt(0)).toBe(0)
    expect(buffer.valueAt(999)).toBe(999)
  })

  it('drops the oldest readings past the point cap', () => {
    const buffer = filled(1_250, 1_000)
    expect(buffer.length).toBe(1_000)
    expect(buffer.valueAt(0)).toBe(250)
    expect(buffer.timeAt(999)).toBe(12_490)
    expect(buffer.toArray().map(p => p.value)).toEqual(Array.from({ length: 1_000 }, (_, i) => 250 + i))
  })

  it('drops readings older than the age cap', () => {
    // A reading every second, kept for a minute.
    const buffer = filled(200, 50_000, 60_000, 1_000)
    expect(buffer.timeAt(0)).toBe(139_000)
    expect(buffer.length).toBe(61)
  })

  it('has the default caps of 50,000 readings and an hour', () => {
    const buffer = new TrendBuffer()
    expect(buffer.maxPoints).toBe(50_000)
    expect(buffer.maxAgeMs).toBe(3_600_000)
  })

  it('finds the first reading at or after a time', () => {
    const buffer = filled(100)
    expect(buffer.lowerBound(-5)).toBe(0)
    expect(buffer.lowerBound(255)).toBe(26)
    expect(buffer.lowerBound(10_000)).toBe(100)
  })
})

describe('windowRange', () => {
  // 100 readings 10 ms apart, the last at 990, which arrived at 990.
  const buffer = filled(100)

  it('shows everything from the first reading to now for All', () => {
    expect(windowRange(buffer, { kind: 'all' }, 1_990)).toEqual({ from: 0, to: 100, tStart: 0, tEnd: 1_990 })
  })

  it('shows the readings inside a time window ending now', () => {
    expect(windowRange(buffer, { kind: 'seconds', seconds: 0.5 }, 990)).toEqual({ from: 49, to: 100, tStart: 490, tEnd: 990 })
  })

  it('shows the last N readings', () => {
    expect(windowRange(buffer, { kind: 'points', count: 10 }, 990)).toEqual({ from: 90, to: 100, tStart: 900, tEnd: 990 })
  })

  it('ends the axis at the newest reading plus how long ago it arrived, whatever the source clock says', () => {
    const skewed = new TrendBuffer()
    skewed.push(5_000, 1, 100_000)
    skewed.push(6_000, 2, 101_000)
    expect(windowRange(skewed, { kind: 'all' }, 103_000)?.tEnd).toBe(8_000)
  })

  it('has nothing to show for an empty buffer', () => {
    expect(windowRange(new TrendBuffer(), { kind: 'all' }, 0)).toBeNull()
  })
})

describe('downsampleMinMax', () => {
  it('draws a short window as it is', () => {
    const buffer = filled(20)
    const range = windowRange(buffer, { kind: 'all' }, 190)!
    expect(downsampleMinMax(buffer, range, 100).values).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  it('reduces 50,000 readings to at most two a pixel column and keeps the peaks', () => {
    const buffer = new TrendBuffer()
    for (let i = 0; i < 50_000; i++) buffer.push(i, Math.sin(i / 50), i)
    buffer.push(50_000, 25, 50_000) // a single spike at the end
    buffer.push(50_001, -25, 50_001)
    const range = windowRange(buffer, { kind: 'all' }, 50_001)!

    const result = downsampleMinMax(buffer, range, 400)

    expect(result.values.length).toBeLessThanOrEqual(800)
    expect(result.yMax).toBe(25)
    expect(result.yMin).toBe(-25)
    // Still in time order.
    for (let i = 1; i < result.times.length; i++) expect(result.times[i]).toBeGreaterThanOrEqual(result.times[i - 1])
  })
})

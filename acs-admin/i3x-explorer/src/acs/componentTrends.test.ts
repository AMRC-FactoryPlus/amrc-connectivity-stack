/*
 * ACS Admin
 * Tests for the layout of several trends
 * Copyright 2026 University of Sheffield
 */

import { describe, expect, it } from 'vitest'
import { trendGridClass } from './ComponentTrends'

describe('trendGridClass', () => {
  it('gives one graph the full width', () => {
    expect(trendGridClass(1)).toContain('grid-cols-1')
    expect(trendGridClass(0)).toContain('grid-cols-1')
  })

  it('fits several side by side, as many columns as the width allows', () => {
    expect(trendGridClass(2)).toContain('repeat(auto-fit,minmax(min(28rem,100%),1fr))')
    expect(trendGridClass(12)).toBe(trendGridClass(2))
  })
})

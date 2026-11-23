/*
 * ACS Admin
 * Tests for numbers that keep their width
 * Copyright 2026 University of Sheffield
 */

import { describe, expect, it } from 'vitest'
import { decimalsOf, formatHeld, holdDecimals } from './heldDecimals'

const fallback = (value: unknown) => `raw:${String(value)}`

describe('decimalsOf', () => {
  it('counts the decimal places, up to six', () => {
    expect(decimalsOf(2)).toBe(0)
    expect(decimalsOf(1.5)).toBe(1)
    expect(decimalsOf(-1.54571)).toBe(5)
    expect(decimalsOf(0.1 + 0.2)).toBe(6)
    expect(decimalsOf(1.5e-7)).toBe(6)
  })
})

describe('holdDecimals', () => {
  it('holds the most decimal places seen, so a shorter reading is padded', () => {
    let held: number | undefined
    for (const value of [1.5, 1.54571, 1.5, 2]) held = holdDecimals(held, value)
    expect(held).toBe(5)
    expect(formatHeld(1.5, held, fallback)).toBe('1.50000')
    expect(formatHeld(2, held, fallback)).toBe('2.00000')
  })

  it('keeps an integer metric as integers', () => {
    let held: number | undefined
    for (const value of [5524, 5525, 5526]) held = holdDecimals(held, value)
    expect(held).toBe(0)
    expect(formatHeld(5526, held, fallback)).toBe('5526')
  })

  it('leaves strings and booleans alone', () => {
    expect(holdDecimals(3, 'Auto')).toBe(3)
    expect(holdDecimals(undefined, true)).toBeUndefined()
    expect(formatHeld('Auto', 3, fallback)).toBe('raw:Auto')
    expect(formatHeld(true, 3, fallback)).toBe('raw:true')
  })

  it('leaves very large or very small numbers to the exponent form', () => {
    expect(formatHeld(4.7e-29, 6, fallback)).toBe('raw:4.7e-29')
    expect(formatHeld(2e20, 0, fallback)).toBe('raw:200000000000000000000')
  })
})

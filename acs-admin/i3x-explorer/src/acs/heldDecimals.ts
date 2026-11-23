/*
 * ACS Admin
 * Numbers that keep their width while a live value changes
 * Copyright 2026 University of Sheffield
 *
 * A metric updating 100 times a second alternates between readings like 1.5 and 1.54571, so a
 * value shown as it comes changes width and everything after it in the row moves sideways. Each
 * element holds the most decimal places it has shown since it was subscribed, up to six, and
 * pads with trailing zeros, so 1.5 shows as 1.50000 once 1.54571 has been seen. Integers stay
 * integers until a fraction arrives. Strings and booleans are shown as they come.
 */

export const MAX_HELD_DECIMALS = 6

/** The decimal places a number is written with, up to the cap: 1.5 has 1, 2 has 0, 1e-7 has 7 → 6. */
export function decimalsOf(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0
  const text = String(Math.abs(value))
  const exponent = text.indexOf('e-')
  if (exponent >= 0) {
    const mantissa = text.slice(0, exponent)
    const fraction = mantissa.split('.')[1]?.length ?? 0
    return Math.min(MAX_HELD_DECIMALS, fraction + Number(text.slice(exponent + 2)))
  }
  return Math.min(MAX_HELD_DECIMALS, text.split('.')[1]?.length ?? 0)
}

/** The decimal places to hold after a reading: the most seen so far, for numbers only. */
export function holdDecimals(previous: number | undefined, value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return previous
  return Math.max(previous ?? 0, decimalsOf(value))
}

/** Magnitudes that read better in exponent form, as upstream's short formatter writes them. */
const isExtreme = (value: number) => Math.abs(value) >= 1e15 || (value !== 0 && Math.abs(value) < 1e-6 && !Number.isInteger(value))

/**
 * A number with the element's held decimal places, padded with zeros; anything else, or a number
 * too large or small for fixed places, goes to `fallback`.
 */
export function formatHeld(value: unknown, decimals: number | undefined, fallback: (value: unknown) => string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || decimals === undefined || isExtreme(value)) {
    return fallback(value)
  }
  return value.toFixed(decimals)
}

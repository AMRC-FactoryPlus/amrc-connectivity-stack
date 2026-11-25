/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* A random v4 UUID. Browsers only offer crypto.randomUUID in a secure
 * context (HTTPS or localhost), so on an ACS served over plain HTTP
 * calling it throws. crypto.getRandomValues is offered everywhere, and
 * is just as random. */
export function random_uuid (source = globalThis.crypto) {
  if (typeof source.randomUUID === 'function') return source.randomUUID()

  const bytes = new Uint8Array(16)
  source.getRandomValues(bytes)
  /* The version (4) and variant (10xx) bits, so this is a real v4. */
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20),
  ].join('-')
}

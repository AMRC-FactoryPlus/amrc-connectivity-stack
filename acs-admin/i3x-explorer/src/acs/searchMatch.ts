// ACS: search matches names the way people type them.
//
// Upstream matched the typed text as one substring, so "line press"
// missed "LinePressThree". Here case, spaces, underscores and other
// punctuation are ignored, and each typed word must appear somewhere in
// the name, in any order. An element ID still matches as typed.

const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** The words of a query, squashed; empty for a blank query. */
export function queryWords(query: string): string[] {
  return query.split(/[^\p{L}\p{N}]+/u).map(squash).filter(Boolean)
}

/** Whether an object with this name and ID matches the query. */
export function matchesQuery(name: string | undefined, elementId: string, query: string): boolean {
  const words = queryWords(query)
  if (words.length === 0) return false
  const squashed = squash(name ?? '')
  if (words.every(word => squashed.includes(word))) return true
  return elementId.toLowerCase().includes(query.trim().toLowerCase())
}

/** 0 when the name starts with the whole query run together, else 1; sorts better matches first. */
export function matchRank(name: string | undefined, query: string): number {
  return squash(name ?? '').startsWith(queryWords(query).join('')) ? 0 : 1
}

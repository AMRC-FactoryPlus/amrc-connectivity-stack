/**
 * ACS: collects items pushed at any rate and hands them over in one batch per animation frame,
 * so a feed of hundreds of updates a second costs one store write and one render per frame.
 * Browsers pause animation frames in a background tab, so a timer flushes too: whichever fires
 * first takes the batch and cancels the other.
 */
export class FrameBatcher<T> {
  private pending: T[] = []
  private frame: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly onFlush: (items: T[]) => void
  private readonly fallbackMs: number

  constructor(onFlush: (items: T[]) => void, fallbackMs = 250) {
    this.onFlush = onFlush
    this.fallbackMs = fallbackMs
  }

  push(items: T[]): void {
    if (items.length === 0) return
    for (const item of items) this.pending.push(item)
    if (this.timer !== null) return
    this.timer = setTimeout(() => this.flush(), this.fallbackMs)
    if (typeof requestAnimationFrame === 'function') {
      this.frame = requestAnimationFrame(() => this.flush())
    }
  }

  /** Hands over everything pending now. */
  flush(): void {
    this.cancelTimers()
    if (this.pending.length === 0) return
    const items = this.pending
    this.pending = []
    this.onFlush(items)
  }

  /** Drops everything pending without handing it over. */
  cancel(): void {
    this.cancelTimers()
    this.pending = []
  }

  get size(): number {
    return this.pending.length
  }

  private cancelTimers(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    if (this.frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame)
    this.timer = null
    this.frame = null
  }
}

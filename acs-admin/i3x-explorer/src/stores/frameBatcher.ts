/**
 * ACS: the window whose animation frames time the flushes, when not this one. While the
 * subscriptions panel is popped out (src/acs/subscriptionsPopout.ts) that window is the one on
 * show, and its frames keep coming when this tab is in the background.
 */
let frameWindow: Window | null = null

export function setFrameWindow(win: Window | null): void {
  frameWindow = win
}

function frameSource(): Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'> | null {
  if (frameWindow && !frameWindow.closed && typeof frameWindow.requestAnimationFrame === 'function') return frameWindow
  return typeof requestAnimationFrame === 'function' ? globalThis as unknown as Window : null
}

/**
 * ACS: collects items pushed at any rate and hands them over in one batch per animation frame,
 * so a feed of hundreds of updates a second costs one store write and one render per frame.
 * Browsers pause animation frames in a background tab, so a timer flushes too: whichever fires
 * first takes the batch and cancels the other.
 */
export class FrameBatcher<T> {
  private pending: T[] = []
  private frame: number | null = null
  private frameFrom: Pick<Window, 'cancelAnimationFrame'> | null = null // ACS
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
    // ACS: on the pop-out window's frames while there is one.
    const source = frameSource()
    if (source) {
      this.frameFrom = source
      this.frame = source.requestAnimationFrame(() => this.flush())
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
    if (this.frame !== null && this.frameFrom) this.frameFrom.cancelAnimationFrame(this.frame)
    this.timer = null
    this.frame = null
    this.frameFrom = null
  }
}

/*
 * ACS Admin
 * The subscriptions panel's choice of how much of each trend the graphs show
 * Copyright 2026 University of Sheffield
 *
 * One choice for every graph in the panel, docked or popped out, kept for the browser session:
 * All (from the first reading to now), a time window, or the last N readings.
 */

import { useState } from 'react'
import { sameWindow, TREND_WINDOW_CHOICES, useTrendWindow } from './trendBuffer'

const segment =
  'px-2 py-0.5 text-[11px] whitespace-nowrap transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-i3x-primary'

export function TrendWindowControl() {
  const trendWindow = useTrendWindow(state => state.window)
  const setWindow = useTrendWindow(state => state.setWindow)
  const [draft, setDraft] = useState(() => (trendWindow.kind === 'points' ? String(trendWindow.count) : ''))

  const applyDraft = (text: string) => {
    setDraft(text)
    const count = Number.parseInt(text, 10)
    if (Number.isFinite(count) && count >= 2) setWindow({ kind: 'points', count })
  }

  return (
    <div role="group" aria-label="Trend window" className="flex items-center gap-2 min-w-0">
      <span className="hidden md:inline text-[11px] text-i3x-text-muted">Trends</span>
      <div className="flex rounded border border-i3x-border overflow-hidden">
        {TREND_WINDOW_CHOICES.map(({ label, window: choice }, i) => {
          const active = sameWindow(trendWindow, choice)
          return (
            <button
              key={label}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setDraft('')
                setWindow(choice)
              }}
              title={choice.kind === 'all' ? 'Show every reading since subscribing' : `Show the last ${label}`}
              className={`${segment} ${i > 0 ? 'border-l border-i3x-border' : ''} ${
                active ? 'bg-i3x-primary/15 text-i3x-primary' : 'text-i3x-text-muted hover:text-i3x-text hover:bg-i3x-surface'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
      <label
        className={`flex items-center gap-1 text-[11px] ${trendWindow.kind === 'points' ? 'text-i3x-primary' : 'text-i3x-text-muted'}`}
        title="Show the last N readings of each trend"
      >
        Last
        <input
          type="number"
          inputMode="numeric"
          min={2}
          step={1}
          value={draft}
          placeholder="N"
          onChange={event => applyDraft(event.target.value)}
          aria-label="Show the last N readings"
          className="w-16 px-1 py-0.5 rounded border border-i3x-border bg-i3x-bg text-i3x-text tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
        />
        readings
      </label>
    </div>
  )
}

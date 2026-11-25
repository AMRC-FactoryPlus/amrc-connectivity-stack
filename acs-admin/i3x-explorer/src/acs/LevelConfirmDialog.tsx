// ACS: the Explorer's own dialog for the question asked before subscribing to a
// large ISA-95 level (levelConfirm.ts). Styled as NumberPromptDialog. Enter
// subscribes, Esc or a click outside cancels.

import { useEffect, useId, useRef } from 'react'
import { useLevelConfirm } from './levelConfirm'

export function LevelConfirmDialog() {
  const request = useLevelConfirm(s => s.request)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const messageId = useId()

  useEffect(() => {
    if (request) confirmRef.current?.focus()
  }, [request])

  if (!request) return null

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onPointerDown={event => {
        if (event.target === event.currentTarget) request.answer(false)
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={event => {
          event.stopPropagation()
          if (event.key === 'Escape') request.answer(false)
        }}
        className="w-[min(26rem,90vw)] bg-i3x-surface border border-i3x-border rounded-xl shadow-xl p-4"
      >
        <h2 id={titleId} className="text-sm font-semibold text-i3x-text">
          {request.title}
        </h2>
        <p id={messageId} className="mt-1 text-[11.5px] text-i3x-text-muted">
          {request.message}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => request.answer(false)}
            className="px-3 py-1.5 text-xs rounded-md text-i3x-text-muted hover:text-i3x-text hover:bg-i3x-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => request.answer(true)}
            className="px-3 py-1.5 text-xs rounded-md bg-i3x-primary text-white hover:bg-i3x-primary/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
          >
            Subscribe to all
          </button>
        </div>
      </div>
    </div>
  )
}

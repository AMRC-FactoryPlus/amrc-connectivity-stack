import { useState } from 'react'
import type { RequestDescriptor } from '../../api/requestShape'
import { CodeIcon, EllipsisIcon } from '../common/icons'
import { ContextMenu } from '../common/ContextMenu' // ACS
import { RequestInspectorModal } from './RequestInspectorModal'
import type { RequestInspectorTab, RequestInspectorVariant } from './requestTabs'

/** One selectable request shape behind a single trigger, e.g. a relationship filter. */
export type CodeSampleVariant = RequestInspectorVariant

interface CodeSampleProps {
  /** A single request to show. Ignored when `variants` or `tabs` is given. */
  descriptor?: RequestDescriptor
  /** Two or more request shapes the reader can switch between in the inspector. */
  variants?: CodeSampleVariant[]
  /** Accessible name for the variant picker, e.g. 'Relationship filter'. */
  variantLabel?: string
  /**
   * A full set of request kinds for the inspector's tab bar. When present it
   * supersedes `descriptor`/`variants`; `initialTabId` picks the tab to focus.
   */
  tabs?: RequestInspectorTab[]
  initialTabId?: string
  /** Object / namespace / type name shown in the inspector header. */
  title?: string
  /** Kind label, e.g. 'Object Instance'. */
  subtitle?: string
}

/**
 * The "View request" badge. Clicking it opens the Request Inspector — a large,
 * IDE-style modal — rather than expanding a code block inline. The trigger owns
 * only a boolean; the modal (and all of its language/redaction state) mounts on
 * demand, so the request tooling never re-renders the potentially heavy content
 * it sits beside (the relationship graph, the raw-JSON viewers). The request
 * shapes themselves come straight from the version-accurate descriptors — this
 * change is presentation only.
 */
export function CardCodeSample({
  descriptor,
  variants,
  variantLabel,
  tabs,
  initialTabId,
  title = 'Request',
  subtitle,
}: CodeSampleProps) {
  const [open, setOpen] = useState(false)

  // A single card passes one descriptor or a variant set; the inspector always
  // works in terms of tabs, so wrap the legacy shape into a one-tab set.
  const resolvedTabs: RequestInspectorTab[] =
    tabs ??
    (variants && variants.length > 0
      ? [{ id: 'request', label: 'Request', variants, variantLabel }]
      : descriptor
        ? [{ id: 'request', label: 'Request', descriptor }]
        : [])

  if (resolvedTabs.length === 0) return null

  const initialTab = resolvedTabs.find(tab => tab.id === initialTabId) ?? resolvedTabs[0]
  const preview = initialTab.descriptor ?? initialTab.variants?.[0]?.descriptor

  // ACS: the request sits behind a "More" (⋯) button in the card header
  // rather than a pill on every card, so the cards read as data first. The
  // menu's one entry opens the same Request Inspector, and its detail shows
  // the method and path the pill used to.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        title="More"
        onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          setMenu({ x: rect.right - 200, y: rect.bottom + 4 })
        }}
        className="inline-flex flex-shrink-0 items-center justify-center rounded p-1 text-i3x-text-muted hover:text-i3x-text hover:bg-i3x-text/[0.06] transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-i3x-primary"
      >
        <EllipsisIcon size={16} />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          entries={[{
            kind: 'action',
            label: 'View request',
            detail: preview?.method,
            icon: <CodeIcon size={12} />,
            onSelect: () => { setMenu(null); setOpen(true) },
          }]}
        />
      )}
      {open && (
        <RequestInspectorModal
          title={title}
          subtitle={subtitle}
          tabs={resolvedTabs}
          initialTabId={initialTabId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

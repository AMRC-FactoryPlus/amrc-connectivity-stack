/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { toast } from 'vue-sonner'

/**
 * Copy text to the clipboard and say so. `what` names the text for the
 * person, as in "Password". The text itself is never logged or shown.
 */
export async function copy_text (text, what) {
  let ok = false
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      ok = true
    }
  }
  catch { /* fall through */ }
  if (!ok) {
    /* An insecure deployment has no clipboard API. */
    const back = document.activeElement
    const ta = document.createElement('textarea')
    ta.readOnly = true
    ta.setAttribute('aria-hidden', 'true')
    ta.tabIndex = -1
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.value = text
    document.body.append(ta)
    ta.select()
    try { ok = document.execCommand('copy') }
    catch { ok = false }
    ta.remove()
    if (back && back.focus) back.focus({ preventScroll: true })
  }
  if (ok) toast.success(what + ' copied to the clipboard.')
  else toast.error('This browser did not allow copying. Select the text and copy it by hand.')
}

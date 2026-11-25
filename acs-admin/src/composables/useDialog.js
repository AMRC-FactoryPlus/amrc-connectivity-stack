/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import { createApp } from 'vue'
import GlobalDialog from '@/components/GlobalDialog.vue'

/* Each dialog is its own small Vue app mounted on the body, outside
 * the router view, so leaving the page does not take it away. The
 * open ones are kept here so a route change can close them. */
const open_dialogs = new Set()

/**
 * Ask a question in a modal dialog. The options are title, message,
 * details, confirmText, cancelText, hideCancel, onConfirm, onCancel and
 * destructive. Set destructive for a question whose yes deletes,
 * removes or throws away something, so the confirm button is red.
 */
export function useDialog(options) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  let app
  /* Confirming or cancelling also emits close, so this can be called
   * twice for one dialog. */
  const dispose = () => {
    if (!open_dialogs.delete(dispose)) return
    app.unmount();
    container.remove();
  }
  open_dialogs.add(dispose)

  app = createApp(GlobalDialog, {
    ...options,
    onClose() {
      dispose();
    },
    onConfirm() {
      if (options.onConfirm) options.onConfirm();
      dispose();
    },
    onCancel() {
      if (options.onCancel) options.onCancel();
      dispose();
    },
  });

  app.mount(container);
}

/**
 * Close every open dialog without confirming or cancelling it. A
 * question asked on one page means nothing on the next.
 */
export function close_dialogs () {
  for (const dispose of [...open_dialogs]) dispose()
}

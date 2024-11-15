/*
 * Copyright (c) University of Sheffield AMRC 2024.
 */

import { createApp } from 'vue'
import GlobalDialog from '@/components/GlobalDialog.vue'

export function useDialog(options) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  console.log(options)

  const app = createApp(GlobalDialog, {
    ...options,
    onClose() {
      app.unmount();
      document.body.removeChild(container);
    },
    onConfirm() {
      if (options.onConfirm) options.onConfirm();
      app.unmount();
      document.body.removeChild(container);
    },
    onCancel() {
      if (options.onCancel) options.onCancel();
      app.unmount();
      document.body.removeChild(container);
    },
  });

  app.mount(container);
}
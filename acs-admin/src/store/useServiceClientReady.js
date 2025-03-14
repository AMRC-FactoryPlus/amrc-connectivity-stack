/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { useServiceClientStore } from '@/store/serviceClientStore.js'

export const serviceClientReady = async () => {
  const serviceClientStore = useServiceClientStore();

  while (!serviceClientStore.client) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
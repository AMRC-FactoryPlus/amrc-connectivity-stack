/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

export const storeReady = async (store) => {

  while (!store.ready) {
    console.debug('Waiting for store to be ready...');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
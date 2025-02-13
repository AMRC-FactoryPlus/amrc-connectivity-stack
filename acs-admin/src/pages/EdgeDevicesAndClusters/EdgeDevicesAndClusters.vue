<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
</template>

<script>
import { useServiceClientStore } from '@/store/serviceClientStore.js'

export default {

  name: 'EdgeDevicesAndClusters',

  setup () {
    return {
      s: useServiceClientStore(),
    }
  },
}
</script>

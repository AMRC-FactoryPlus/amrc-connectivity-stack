<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- What a Gateway Depot page shows before it has its gateways: that
     the person may not use the depot, that the service did not answer,
     or that the list is on its way. Once loaded it shows the page, with
     a note above it while the service is out of reach. -->
<template>
  <EmptyState v-if="depot.forbidden"
      icon="lock"
      title="You do not have permission to use Gateway Depot"
      description="Gateway Depot needs the Provision gateways permission, and a Factory+ administrator can grant it."
      button-text="Try again"
      @button-click="depot.retry()"/>
  <EmptyState v-else-if="!depot.loaded && depot.error"
      icon="triangle-exclamation"
      title="Gateway Depot"
      :description="depot.error"
      button-text="Try again"
      @button-click="depot.retry()"/>
  <div v-else-if="!depot.loaded" role="status" aria-label="Loading.">
    <Skeleton v-for="i in 6" :key="i" class="mb-2 h-16 rounded-lg"/>
  </div>
  <div v-else class="flex flex-col gap-4">
    <div v-if="depot.lost" class="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
      <i class="fa-solid fa-triangle-exclamation mr-2"></i>Connection to the service lost. Retrying.
    </div>
    <slot></slot>
  </div>
</template>

<script setup>
import EmptyState from '@components/EmptyState.vue'
import { Skeleton } from '@components/ui/skeleton'
import { useGatewayDepotStore } from '@store/useGatewayDepotStore.js'

const depot = useGatewayDepotStore()
</script>

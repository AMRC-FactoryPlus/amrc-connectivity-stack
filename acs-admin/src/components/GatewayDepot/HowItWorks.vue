<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The five steps every gateway goes through. -->
<template>
  <div class="flex flex-col gap-4">
    <ol class="list-decimal pl-5 flex flex-col gap-2 text-sm">
      <li v-for="[title, text] in HOW" :key="title" class="pl-1">
        <b class="font-semibold">{{ title }}</b> {{ text }}
      </li>
    </ol>
    <p v-if="depot.k3sVersion" class="text-xs text-slate-500">Onboarding installs K3s {{ depot.k3sVersion }}.</p>
  </div>
</template>

<script setup>
import { useGatewayDepotStore } from '@store/useGatewayDepotStore.js'
import { HOW } from '@/lib/gateway-depot/model.js'

const depot = useGatewayDepotStore()
</script>

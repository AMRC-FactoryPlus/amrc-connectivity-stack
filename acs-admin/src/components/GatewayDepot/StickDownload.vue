<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The depot USB stick image. The service builds it, and the browser
     downloads it with a plain link, because it holds no secrets. -->
<template>
  <div v-if="stick" class="flex items-center gap-3">
    <span v-if="ready && size" class="text-xs text-slate-500">{{ size }}</span>
    <a v-if="ready" :href="stick.url" download :class="buttonVariants({ variant: 'outline' })">
      <i class="fa-solid fa-download mr-2"></i>
      Download depot stick
    </a>
    <Button v-else variant="outline" disabled>
      <i v-if="stick.state === 'building'" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
      {{ stick.state === 'building' ? 'Building the depot stick' : 'No depot stick yet' }}
    </Button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Button, buttonVariants } from '@/components/ui/button'
import { useGatewayDepotStore } from '@store/useGatewayDepotStore.js'
import { disk_size } from '@/lib/gateway-depot/model.js'

const depot = useGatewayDepotStore()
const stick = computed(() => depot.stick)
const ready = computed(() => stick.value?.state === 'ready' && !!stick.value.url)
const size = computed(() => (stick.value?.size ? disk_size(stick.value.size) : ''))
</script>

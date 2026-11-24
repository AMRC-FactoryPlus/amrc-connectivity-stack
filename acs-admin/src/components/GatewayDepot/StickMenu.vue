<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The more-actions menu beside View on the gateway list. It holds the
     depot USB stick download, which is a plain link because the stick
     holds no secrets. -->
<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button size="sm" variant="outline" aria-label="More actions" title="More actions">
        <i class="fa-solid fa-ellipsis"></i>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-64">
      <DropdownMenuItem v-if="ready" as-child>
        <a :href="stick.url" download class="flex items-center gap-2">
          <i class="fa-solid fa-fw fa-download text-xs"></i>Download depot stick
        </a>
      </DropdownMenuItem>
      <DropdownMenuItem v-else disabled class="flex-col items-start gap-0">
        <span class="flex items-center gap-2"><i class="fa-solid fa-fw fa-download text-xs"></i>Download depot stick</span>
        <span class="pl-6 text-xs text-slate-500">{{ reason }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<script setup>
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useGatewayDepotStore } from '@store/useGatewayDepotStore.js'

const depot = useGatewayDepotStore()
const stick = computed(() => depot.stick)
const ready = computed(() => stick.value?.state === 'ready' && !!stick.value.url)
const reason = computed(() => (stick.value?.state === 'building' ? 'The depot stick is being built' : 'There is no depot stick yet'))
</script>

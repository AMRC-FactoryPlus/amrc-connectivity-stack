<script setup lang="ts">
import type { Column } from '@tanstack/vue-table'
import type { Alert } from './columns'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface DataTableColumnHeaderProps {
  column: Column<Alert, any>
  title: string
}

defineProps<DataTableColumnHeaderProps>()
</script>

<script lang="ts">
export default {
  inheritAttrs: false,
}
</script>

<template>
  <div v-if="column.getCanSort()" :class="cn('flex items-center space-x-2', $attrs.class ?? '')">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="sm"
          class="-ml-3 h-8 data-[state=open]:bg-accent gap-2 group"
        >
          <span>{{ title }}</span>
          <i class="fa-solid fa-arrow-down" v-if="column.getIsSorted() === 'desc'"></i>
          <i class="fa-solid fa-arrow-up" v-else-if="column.getIsSorted() === 'asc'"></i>
          <i class="fa-solid fa-sort !invisible group-hover:!visible" v-else></i>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem class="gap-2" @click="column.toggleSorting(false)">
          <i class="fa-solid fa-arrow-up text-muted-foreground/70"></i>
          Asc
        </DropdownMenuItem>
        <DropdownMenuItem class="gap-2" @click="column.toggleSorting(true)">
          <i class="fa-solid fa-arrow-down text-muted-foreground/70"></i>
          Desc
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem class="gap-2" @click="column.toggleVisibility(false)">
          <i class="fa-solid fa-eye-slash text-muted-foreground/70"></i>
          Hide
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>

  <div v-else :class="$attrs.class">
    {{ title }}
  </div>
</template>

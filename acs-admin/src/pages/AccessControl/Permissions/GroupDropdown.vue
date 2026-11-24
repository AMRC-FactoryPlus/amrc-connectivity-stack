<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<script setup lang="ts">
import type {Row} from '@tanstack/vue-table'
import type {Alert} from './columns'

import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuGroup} from '@/components/ui/dropdown-menu'
import {toast} from "vue-sonner";

interface DataTableRowActionsProps {
    row: Row<Alert>
}

const props = defineProps<DataTableRowActionsProps>()

function copy(id: string) {
    navigator.clipboard.writeText(id)
    toast.success('UUID copied to clipboard')
}

</script>

<template>
  <DropdownMenu>
    <div @click.stop>
      <DropdownMenuTrigger as-child>
        <Button
            variant="ghost"
            class="flex h-8 w-8 p-0 data-[state=open]:bg-muted"
        >
          <i class="fa-solid fa-ellipsis"></i>
          <span class="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
    </div>
    <DropdownMenuContent align="end" class="w-[160px]">
      <DropdownMenuGroup>
        <DropdownMenuItem @click="copy(props.row.original.uuid)">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-fw fa-tag"></i>
            Copy UUID
          </div>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <!-- No "Remove from Group" here: it called Auth.remove_from_group,
           which always throws because Auth v2 dropped that API. Remove
           members from the group's own page instead. -->
    </DropdownMenuContent>
  </DropdownMenu>
</template>

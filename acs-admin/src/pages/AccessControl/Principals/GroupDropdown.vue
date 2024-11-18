<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<script setup lang="ts">
import type {Row} from '@tanstack/vue-table'
import type {Alert} from './columns'

import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {toast} from "vue-sonner";
import {useDialog} from '@/composables/useDialog';
import {useServiceClientStore} from '@store/serviceClientStore.js'

interface DataTableRowActionsProps {
    row: Row<Alert>
}

const s = useServiceClientStore()

const props = defineProps<DataTableRowActionsProps>()

function copy(id: string) {
    navigator.clipboard.writeText(id)
    toast.success('UUID copied to clipboard')
}

function handleDelete() {
    useDialog({
        title: 'Remove from group?',
        message: `Are you sure that you want to remove ${props.row.original.principal.kerberos} from the ${props.row.original.name} group? The user will lose all permissions associated with the group.`,
        confirmText: 'Remove from Group',
        onConfirm: () => {
            console.log(props.row.original.principal);
            s.client.Auth.remove_from_group(props.row.original.uuid, props.row.original.principal.uuid).then(() => {
                toast.success(`${props.row.original.principal.kerberos} has been removed from the ${props.row.original.name} group`)
            }).catch((err) => {
                toast.error(`Unable to remove ${props.row.original.principal.kerberos} from ${props.row.original.name}`)
                console.error(`Unable to remove ${props.row.original.principal.kerberos} from ${props.row.original.name}`, err)
            })
        }
    });
}

</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
          variant="ghost"
          class="flex h-8 w-8 p-0 data-[state=open]:bg-muted"
      >
        <i class="fa-solid fa-ellipsis"></i>
        <span class="sr-only">Open menu</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-[160px]">
      <DropdownMenuGroup>
        <DropdownMenuItem @click="copy(props.row.original.uuid)">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-fw fa-tag"></i>
            Copy UUID
          </div>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator/>
      <DropdownMenuGroup>
        <DropdownMenuItem @click="handleDelete">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-fw fa-trash text-red-500"></i>
            Remove
          </div>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

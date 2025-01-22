<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<script setup lang="ts">
import type {Row} from '@tanstack/vue-table'
import type {Principal} from './membersColumns'

import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuGroup} from '@/components/ui/dropdown-menu'
import {toast} from "vue-sonner";
import {useDialog} from '@/composables/useDialog';
import {useServiceClientStore} from '@store/serviceClientStore.js'
import {useGroupStore} from '@store/useGroupStore.js'
import { inject } from 'vue'

const groupMembersUpdated = inject('groupMembersUpdated')

interface DataTableRowActionsProps {
    row: Row<Principal>
}

const s = useServiceClientStore()
const g = useGroupStore()

const props = defineProps<DataTableRowActionsProps>()

function copy(id: string) {
    navigator.clipboard.writeText(id)
    toast.success('UUID copied to clipboard')
}

function handleDelete() {
    useDialog({
        title: 'Remove from group?',
        message: `Are you sure that you want to remove ${props.row.original.name} from ${props.row.original.group.name}? The user will lose all permissions associated with the group.`,
        confirmText: 'Remove from Group',
        onConfirm: () => {
            s.client.Auth.remove_from_group(props.row.original.group.uuid, props.row.original.uuid).then(async () => {
                toast.success(`${props.row.original.name} has been removed from ${props.row.original.group.name}`)
                s.client.Fetch.cache = "reload"
                // Jetbrains doesn't understand this, but it works
                await groupMembersUpdated()
                s.client.Fetch.cache = "default"
            }).catch((err) => {
                toast.error(`Unable to remove ${props.row.original.name} from ${props.row.original.group.name}`)
                console.error(`Unable to remove ${props.row.original.name} from ${props.row.original.group.name}`, err)
            })
        }
    });
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
    <DropdownMenuContent align="end" class="w-[250px]">
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
            Remove from Group
          </div>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

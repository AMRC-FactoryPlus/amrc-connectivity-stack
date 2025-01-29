<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<script setup lang="ts">
import type {Row} from '@tanstack/vue-table'
import type {Permission} from './permissionColumns'

import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuGroup} from '@/components/ui/dropdown-menu'
import {toast} from "vue-sonner";
import {useDialog} from '@/composables/useDialog';
import {useServiceClientStore} from '@store/serviceClientStore.js'
import { inject } from 'vue'

const permissionMembershipUpdated = inject('permissionMembershipUpdated')

interface DataTableRowActionsProps {
    row: Row<Permission>
}

const s = useServiceClientStore()

const props = defineProps<DataTableRowActionsProps>()

function copy(id: string) {
    navigator.clipboard.writeText(id)
    toast.success('UUID copied to clipboard')
}

function handleDelete() {
    useDialog({
        title: 'Revoke this permission?',
        message: `Are you sure that you want to revoke ${props.row.original.permission.name} on ${props.row.original.target.name} from ${props.row.original.principal.name}?`,
        confirmText: 'Revoke Permission',
        onConfirm: () => {
            s.client.Auth.delete_ace (props.row.original.principal.uuid, props.row.original.permission.uuid, props.row.original.target.uuid).then(async () => {
              toast.success(`${props.row.original.permission.name} on ${props.row.original.target.name} has been revoked from ${props.row.original.principal.name}`)
              s.client.Fetch.cache = "reload"
              // Jetbrains doesn't understand this, but it works
              await permissionMembershipUpdated()
              s.client.Fetch.cache = "default"
            }).catch((err) => {
              toast.error(`Unable to revoke ${props.row.original.permission.name} on ${props.row.original.target.name} from ${props.row.original.principal.name}`)
              console.error(`Unable to revoke ${props.row.original.permission.name} on ${props.row.original.target.name} from ${props.row.original.principal.name}`, err)
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
        <DropdownMenuItem @click="copy(props.row.original.permission.uuid)" class="cursor-pointer">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-fw fa-tag"></i>
            Copy Permission UUID
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem @click="copy(props.row.original.target.uuid)" class="cursor-pointer">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-fw fa-tag"></i>
            Copy Target UUID
          </div>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator/>
      <DropdownMenuGroup>
        <DropdownMenuItem @click="handleDelete" class="cursor-pointer">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-fw fa-trash text-red-500"></i>
            Revoke Permission
          </div>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

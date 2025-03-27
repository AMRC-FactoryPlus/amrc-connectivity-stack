<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<script setup lang="ts">
import type {Row} from '@tanstack/vue-table'
import type {MemberOfMapping} from './objectMemberOfListColumns'
import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuGroup} from '@/components/ui/dropdown-menu'
import {toast} from "vue-sonner";
import {useDialog} from '@/composables/useDialog';
import {useServiceClientStore} from '@store/serviceClientStore.js'

import { inject } from 'vue'
import {UUIDs} from "@amrc-factoryplus/service-client";
const relationshipsUpdated = inject('relationshipsUpdated')

interface DataTableRowActionsProps {
    row: Row<MemberOfMapping>
}

const s = useServiceClientStore()
const cdb = s.client.ConfigDB

const props = defineProps<DataTableRowActionsProps>()

function copy(id: string) {
    navigator.clipboard.writeText(id)
    toast.success('UUID copied to clipboard')
}

function handlePrimaryClass() {
  useDialog({
    title: 'Change Primary Class?',
    message: `Are you sure you want to change the primary class of ${props.row.original.originalObject.name} from ${props.row.original.originalObject.class.name} to ${props.row.original.name}`,
    confirmText: 'Change',
    onConfirm: async () => {
      try {
        await cdb.patch_config(UUIDs.App.Registration, props.row.original.originalObject.uuid, "merge", {"class": props.row.original.uuid})
        toast.success(`The primary class of ${props.row.original.originalObject.name} is now ${props.row.original.name}`)
        relationshipsUpdated()
      } catch (err) {
        toast.error(`Unable to delete ${props.row.original.uuid}`)
      }
    }
  });
}

function handleDelete() {
  useDialog({
    title: 'Remove Membership?',
    message: `Are you sure you want to remove the membership of ${props.row.original.name}`,
    confirmText: 'Remove',
    onConfirm: async () => {
      try {
        await cdb.class_remove_member(props.row.original.uuid, props.row.original.originalObject.uuid)
        toast.success(`Membership of ${props.row.original.name} has been removed`)
        relationshipsUpdated()
      } catch (err) {
        toast.error(`Unable to remove membership from ${props.row.original.name}`)
      }
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
        <DropdownMenuItem @click="copy(props.row.original.uuid)" class="cursor-pointer">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-fw fa-tag"></i>
            Copy Object UUID
          </div>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuGroup>
        <DropdownMenuItem @click="copy(props.row.original.class.uuid)" class="cursor-pointer">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-fw fa-tag"></i>
            Copy Class UUID
          </div>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <div v-if="props.row.original.uuid !== props.row.original.originalObject.class.uuid">
        <DropdownMenuSeparator/>
        <DropdownMenuGroup>
          <DropdownMenuItem @click="handlePrimaryClass" class="cursor-pointer">
            <div class="flex items-center justify-center gap-2">
              <i class="fa-solid fa-fw fa-tag"></i>
              Set as Primary Class
            </div>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </div>
      <div v-if="props.row.original.direct === 'Direct'">
        <DropdownMenuSeparator/>
        <DropdownMenuGroup>
          <DropdownMenuItem @click="handleDelete" class="cursor-pointer">
            <div class="flex items-center justify-center gap-2">
              <i class="fa-solid fa-fw fa-trash text-red-500"></i>
              Remove from Group
            </div>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

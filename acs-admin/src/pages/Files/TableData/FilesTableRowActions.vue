<script setup lang="ts">
import type {Row} from '@tanstack/vue-table'
import type {Alert} from './columns'
import {useFileDownload} from "@composables/useFileDownload.js";
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import {Button} from '@/components/ui/button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,} from '@/components/ui/dropdown-menu'

interface DataTableRowActionsProps {
  row: Row<Alert>
}

const props = defineProps<DataTableRowActionsProps>()

const s = useServiceClientStore();

function copy(id: string) {
  navigator.clipboard.writeText(id)
}
async function download(row){
  if(!row.original.uuid)
    return;
  const name = row?.original.filesConfiguration?.original_file_name ?? row.original.uuid;
  await useFileDownload(s.client, name, row.original.uuid);
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
      <DropdownMenuItem @click="copy(props.row.original.uuid)">
        Copy UUID
      </DropdownMenuItem>
      <DropdownMenuItem @click="download(props.row)">
        Download
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>


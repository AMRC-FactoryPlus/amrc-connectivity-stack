<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="showModal" @update:open="e => showModal = e">
    <DialogTrigger>
      <slot></slot>
    </DialogTrigger>
    <DialogContent class="sm:max-w-[80vw]">
      <DialogHeader>
        <VisuallyHidden>
          <DialogTitle>Hello</DialogTitle>
        </VisuallyHidden>
        <VisuallyHidden>
          <DialogDescription></DialogDescription>
        </VisuallyHidden>
        <div class="flex flex-col">
          <h1 class="font-semibold">{{title}}</h1>
          <h3 class="text-xs text-gray-400 -mt-0.5">{{subtitle}}</h3>
        </div>
      </DialogHeader>
      <div class="flex flex-col justify-center gap-6 overflow-auto flex-1 fix-inset">
        <DataTableSearchable v-if="columns" :data="storeData" :search-key="titleKey" :columns="columns" :limit-height="true" :filters="[]">
          <template #default="slotProps">
            <Button :disabled="!slotProps.selectedUsers.length" @click="() => {$emit('update:modelValue', slotProps.selectedUsers); showModal = false}" >Confirm Selection</Button>
          </template>
        </DataTableSearchable>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@components/ui/dialog'
import { VisuallyHidden } from 'radix-vue'
import DataTableSearchable from '@components/ui/data-table-searchable/DataTableSearchable.vue'
import { Input } from '@/components/ui/input'
import { buildColumns } from './columns.ts'
import {Button} from "@components/ui/button/index.js";
import {Sheet} from "@components/ui/sheet/index.js";

export default {

  setup () {
    return {}
  },

  components: {
    Sheet,
    Button,
    DataTableSearchable,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    VisuallyHidden,
    Input,
  },

  emits: ['update:modelValue'],

  props: {
    modelValue: {
      type: Array,
      default: () => [],
    },

    title: {
      type: String,
      default: 'Select Object',
    },

    subtitle: {
      type: String,
    },

    storeData: {
      type: Array,
      required: true,
    },

    valueKey: {
      type: String,
      default: 'uuid',
    },

    titleKey: {
      type: String,
      required: true,
    },

    titleHeader: {
      type: String,
      default: 'Name',
    },

    detailKey: {
      type: String,
      required: true,
    },

    detailHeader: {
      type: String,
      default: 'Description',
    },
  },

  watch: {
    selected (val) {
      this.$emit('update:modelValue', val)
    },
  },

  mounted () {
    this.columns = buildColumns(this.valueKey, this.titleKey, this.titleHeader, this.detailKey, this.detailHeader)
  },

  data () {
    return {
      columns: null,
      selected: [],
      showModal: false
    }
  },
}
</script>
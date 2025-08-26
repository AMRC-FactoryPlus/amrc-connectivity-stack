<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="showModal" @update:open="e => updateOpen(e)">
    <DialogTrigger>
      <slot></slot>
    </DialogTrigger>
    <DialogContent class="sm:max-w-[80vw]">
      <DialogHeader>
        <div class="flex flex-col">
          <DialogTitle>{{title}}</DialogTitle>
          <DialogDescription>{{subtitle}}</DialogDescription>
        </div>
      </DialogHeader>
      <div class="flex flex-col justify-center gap-6 overflow-auto flex-1 fix-inset">
        <DataTableSearchable
            v-if="columns"
            :selected-objects="modelValue"
            :default-sort="initialSort"
            :data="storeData"
            :search-key="null"
            :columns="columns"
            :limit-height="true"
            :clickable="!multiSelect"
            @row-click="e => {$emit('update:modelValue', [e.original]); updateOpen(false)}"
            :filters="[]">
          <template #toolbar-left="slotProps">
            <div class="text-slate-500 whitespace-nowrap">
              Showing {{slotProps.table.getFilteredRowModel().rows.length}} of {{slotProps.table.getPreFilteredRowModel().rows.length}}
            </div>
          </template>
          <template #toolbar-right="slotProps">
            <div class="flex items-center justify-center gap-2">
              <div v-if="multiSelect" class="whitespace-nowrap mr-4">{{slotProps.selectedObjects.length}} selected</div>
              <slot name="actions"></slot>
              <Button :disabled="!slotProps.selectedObjects.length"
                  @click="() => {$emit('update:modelValue', slotProps.selectedObjects); updateOpen(false)}">
                <div class="flex items-center justify-center gap-2">
                  <div>{{confirmText}}</div>
                  <i v-if="confirmIcon" :class="`fa-solid fa-${confirmIcon}`"></i>
                </div>
              </Button>
            </div>
          </template>
        </DataTableSearchable>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@components/ui/dialog'
import { VisuallyHidden } from 'reka-ui'
import DataTableSearchable from '@components/ui/data-table-searchable/DataTableSearchable.vue'
import { Input } from '@/components/ui/input'
import { buildColumns } from './columns.ts'
import { Button } from '@components/ui/button/index.js'
import { Sheet } from '@components/ui/sheet/index.js'

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

  emits: ['update:modelValue', 'update:open'],

  methods: {
    updateOpen (value) {
      this.showModal = value
      this.$emit('update:open', value)
    },
  },

  props: {
    open: false,

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

    column1Header: {
      type: String,
      default: 'Name',
    },

    column1MainKey: {
      type: String,
      required: true,
    },

    column1SubKey: {
      type: String,
      required: false,
    },

    column2Header: {
      type: String,
      default: 'Description',
    },

    column2MainKey: {
      type: String,
      required: true,
    },

    column2SubKey: {
      type: String,
      required: false,
    },

    confirmText: {
      type: String,
      default: 'Confirm',
    },

    confirmIcon: {
      type: String,
      default: 'check',
    },

    multiSelect: {
      type: Boolean,
      default: true,
    }
  },

  watch: {
    selected (val) {
      this.$emit('update:modelValue', val)
    },
    open (value) {
      this.showModal = value
    },
  },

  computed: {
    initialSort () {
      return [{
        id: this.column1MainKey,
        desc: false
      }]
    },
  },

  mounted () {
    this.columns = buildColumns(this.column1Header, this.column1MainKey, this.column1SubKey, this.column2Header, this.column2MainKey, this.column2SubKey, this.multiSelect)
  },

  data () {
    return {
      columns: null,
      selected: [],
      showModal: false,
    }
  },
}
</script>
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
        <DataTableSearchable :selected-objects="modelValue" v-if="columns" :data="storeData" :search-key="titleKey" :columns="columns" :limit-height="true" :filters="[]">
          <template #default="slotProps">
            <div class="flex items-center justify-center gap-2">
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
import { VisuallyHidden } from 'radix-vue'
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

    confirmText: {
      type: String,
      default: 'Confirm',
    },

    confirmIcon: {
      type: String,
      default: 'check',
    },
  },

  watch: {
    selected (val) {
      this.$emit('update:modelValue', val)
    },
    open (value) {
      this.showModal = value
    },
  },

  mounted () {
    this.columns = buildColumns(this.valueKey, this.titleKey, this.titleHeader, this.detailKey, this.detailHeader)
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
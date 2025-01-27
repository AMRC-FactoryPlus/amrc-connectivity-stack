<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog>
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
        <DataTable v-if="columns" :data="storeData" :columns="columns" :filters="[{
        name: titleHeader,
        property: titleKey,
        options: filterOptions
        }]">
          <template #toolbar-left="{table}">
            <div class="p-1 w-full flex flex-col overflow-auto">
              <div class="relative w-full max-w-sm items-center">
                <Input class="pl-8" id="search" type="text" placeholder="Search..."
                    :model-value="table.getColumn(titleKey)?.getFilterValue()"
                    @update:model-value=" table.getColumn(titleKey)?.setFilterValue($event)"
                />
                <div class="px-3 absolute start-0 inset-y-0 flex items-center justify-center text-gray-500">
                  <i class="text-sm fa-solid fa-search"></i>
                </div>
              </div>
            </div>
          </template>
        </DataTable>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@components/ui/Dialog'
import { VisuallyHidden } from 'radix-vue'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { Input } from '@/components/ui/input'
import { buildColumns } from './columns.ts'

export default {

  setup () {
    return {}
  },

  components: {
    DataTable,
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

  computed: {
    filterOptions () {
      return this.storeData.map((g) => g[this.titleKey]).filter((v, i, a) => a.indexOf(v) === i).map((g) => {
        return {
          label: g,
          value: g,
        }
      })

    },
  },

  data () {
    return {
      columns: null,
      selected: [],
    }
  },
}
</script>
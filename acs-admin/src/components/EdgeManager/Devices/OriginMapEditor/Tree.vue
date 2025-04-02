<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <!-- Metric node -->
  <SidebarMenuButton
      v-if="item.type === 'metric'"
      :is-active="false"
      class="h-7 pl-6 border-l rounded-none -ml-2 hover:bg-gray-100"
      @click="handleSelect"
  >
    {{item.name}}
  </SidebarMenuButton>

  <!-- Expandable node (object or schemaArray) -->
  <SidebarMenuItem v-else-if="isExpandable && item.type !== 'schemaArray'">
    <Collapsible
        class="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
        :default-open="true"
    >
      <CollapsibleTrigger
          class="flex w-full items-center py-1 text-sm h-7 gap-1"
      >
        <ChevronRight class="size-4 shrink-0 text-muted-foreground transition-transform duration-200"/>
        <span>{{item.name}}</span>
        <div class="ml-auto size-6 flex items-center justify-center">
          <i class="fa-solid fa-folder text-gray-200 fa-fw"></i>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div class="ml-4">
          <Tree
              v-for="(child, index) in item.children"
              :key="index"
              :item="child"
              @select="$emit('select', $event)"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  </SidebarMenuItem>

  <!-- Schema Array node -->
  <SidebarMenuItem v-else-if="item.type === 'schemaArray'">
    <Collapsible
        class="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
        :default-open="true"
    >
      <CollapsibleTrigger
          class="flex w-full items-center py-1 text-sm"
      >
        <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200"/>
        <span class="ml-1">{{item.name}}</span>
        <Button variant="outline" size="plain" class="ml-auto h-5 pl-1 pr-1.5 flex items-center justify-center gap-0.5 text-gray-500 border-gray-400 text-xs hover:!bg-gray-900 hover:!border-gray-900 hover:!text-white" @click.stop="showNewItemDialog = true">
          <i class="fa-solid fa-plus fa-fw" style="font-size: 10px"></i>
          <div>New</div>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div class="ml-4">
          <div v-if="dynamicItems.length === 0" class="text-sm text-gray-500 py-2">
            No items added
          </div>
          <Tree
              v-for="childItem in dynamicItems"
              :key="childItem.name"
              :item="childItem"
              @select="$emit('select', $event)"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
    <NewSchemaArrayItemDialog
      v-model:open="showNewItemDialog"
      :item-name="item.name"
      :existing-items="dynamicItems.map(item => item.name)"
      @create="handleNewItem"
    />
  </SidebarMenuItem>
</template>

<script>
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar'
import { ChevronRight, File, Folder } from 'lucide-vue-next'
import { Button } from '@components/ui/button/index.js'
import NewSchemaArrayItemDialog from './NewSchemaArrayItemDialog.vue'

export default {
  name: 'Tree',

  components: {
    Button,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    ChevronRight,
    File,
    Folder,
    NewSchemaArrayItemDialog,
  },

  props: {
    item: {
      type: Object,
      required: true,
      validator: (value) => {
        return [
          'name' in value, 'type' in value, 'path' in value, Array.isArray(value.path),
        ].every(Boolean)
      },
    },
  },

  emits: ['select', 'add-instance'],

  data () {
    return {
      dynamicItems: [],
      showNewItemDialog: false,
    }
  },

  computed: {
    isExpandable () {
      return this.item.type === 'object' || this.item.type === 'schemaArray' || this.item.type === 'patternProperty'
    },
  },

  methods: {
    handleSelect () {
      if (this.item.type === 'metric') {
        this.$emit('select', {
          key: this.item.name,
          path: this.item.path,
          schemaUUID: this.item.schemaUUID,
        })
      }
    },

    handleNewItem(name) {
      // Create a new item with the same schema structure as the pattern
      const newItem = {
        name,
        type: 'object',
        path: [...this.item.path, name],
        children: this.item.children?.map(child => ({
          ...child,
          path: [...this.item.path, name, child.name],
        })) || [],
      }

      this.dynamicItems.push(newItem)
      this.$emit('add-instance', {
        parentPath: this.item.path,
        name,
        pattern: this.item.pattern,
      })
    },
  },
}
</script>
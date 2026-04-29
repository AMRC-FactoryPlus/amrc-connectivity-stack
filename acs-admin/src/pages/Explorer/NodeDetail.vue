<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import SidebarDetail from '@components/SidebarDetail.vue'
import { Badge } from '@/components/ui/badge'

const props = defineProps({
  node: { type: Object, required: true },
})

const emit = defineEmits(['subscribe'])

const compositionLabel = computed(() => props.node.isComposition ? 'Yes' : 'No')
</script>

<template>
  <div>
    <div class="flex items-center justify-start gap-2 p-4 border-b">
      <i class="fa-fw fa-solid" :class="node.isComposition ? 'fa-folder text-amber-500' : 'fa-circle-dot text-slate-500'"></i>
      <div class="font-semibold text-xl truncate">{{ node.displayName }}</div>
    </div>
    <div class="space-y-4 p-4">
      <SidebarDetail
        icon="fingerprint"
        label="Element ID"
        :value="node.elementId"
      />
      <SidebarDetail
        icon="tag"
        label="Type ID"
        :value="node.typeElementId"
      />
      <SidebarDetail
        icon="sitemap"
        label="Parent ID"
        :value="node.parentId || '(root)'"
      />
      <SidebarDetail
        icon="globe"
        label="Namespace URI"
        :value="node.namespaceUri || '-'"
      />
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-1.5">
          <i class="fa-fw fa-solid fa-cubes" style="font-size: 0.6rem"></i>
          <label class="flex items-center rounded-md text-xs font-medium">Composition</label>
        </div>
        <Badge :variant="node.isComposition ? 'default' : 'secondary'" class="w-fit">
          {{ compositionLabel }}
        </Badge>
      </div>

      <div class="pt-4 border-t">
        <Button class="w-full" @click="emit('subscribe')">
          <i class="fa-solid fa-eye mr-2"></i>
          Subscribe
        </Button>
      </div>
    </div>
  </div>
</template>

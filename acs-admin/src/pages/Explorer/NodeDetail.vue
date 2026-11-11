<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<script setup>
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import SidebarDetail from '@components/SidebarDetail.vue'
import { Badge } from '@/components/ui/badge'
import { useI3xClient } from '@composables/useI3xClient.js'
import { useExplorerStore } from '@store/useExplorerStore.js'
import { contents_of, parent_of } from '@/lib/explorer/model.js'

const props = defineProps({
  node: { type: Object, required: true },
})

const emit = defineEmits(['subscribe'])

const store = useExplorerStore()
const i3x = useI3xClient()

const type = computed(() => store.typeOf(props.node))

// The object's i3X metadata: what it is related to. Read when the
// selection changes; the rest of the panel does not wait for it.
const metadata = ref(null)
watch(() => props.node?.elementId, async id => {
  metadata.value = null
  if (!id) return
  try {
    const found = await i3x.getObjectMetadata(id)
    if (props.node?.elementId === id) metadata.value = found
  }
  catch { /* the panel shows without it */ }
}, { immediate: true })

const contents = computed(() => contents_of(metadata.value))
const parentId = computed(() => props.node.parentId ?? parent_of(metadata.value))
const parentName = computed(() => store.nodes.get(parentId.value)?.node?.displayName ?? null)
</script>

<template>
  <div>
    <div class="flex items-center justify-start gap-2 p-4 border-b">
      <i class="fa-fw fa-solid" :class="type.icon"></i>
      <div class="font-semibold text-xl truncate">{{ node.displayName }}</div>
    </div>
    <div class="space-y-4 p-4">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-1.5">
          <i class="fa-fw fa-solid fa-shapes" style="font-size: 0.6rem"></i>
          <label class="flex items-center rounded-md text-xs font-medium">Kind</label>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" class="w-fit">{{ type.label }}</Badge>
          <Badge v-for="c in contents" :key="c.relationship" variant="outline" class="w-fit" :title="c.relationship">
            {{ c.label }}
          </Badge>
        </div>
      </div>
      <SidebarDetail
        icon="tag"
        label="Type"
        :value="type.name ?? node.typeElementId"
      />
      <SidebarDetail
        v-if="type.name"
        icon="tag"
        label="Type ID"
        :value="node.typeElementId"
      />
      <SidebarDetail
        icon="fingerprint"
        label="Element ID"
        :value="node.elementId"
      />
      <SidebarDetail
        icon="sitemap"
        label="Parent"
        :value="parentId ? (parentName ?? parentId) : '(root)'"
      />
      <SidebarDetail
        v-if="parentId && parentName"
        icon="sitemap"
        label="Parent ID"
        :value="parentId"
      />
      <SidebarDetail
        icon="globe"
        label="Type namespace"
        :value="metadata?.typeNamespaceUri ?? type.namespaceUri ?? ''"
      />

      <div class="pt-4 border-t">
        <Button class="w-full" @click="emit('subscribe')">
          <i class="fa-solid fa-eye mr-2"></i>
          Subscribe
        </Button>
      </div>
    </div>
  </div>
</template>

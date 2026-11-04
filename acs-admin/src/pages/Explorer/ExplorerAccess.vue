<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- i3X read access for the selected Explorer node: an ISA-95 level
     (granted on its vocabulary node) or a device. Other nodes are read
     with their device, so show nothing for them. -->
<script setup>
import { computed, onMounted } from 'vue'
import { useExplorerStore } from '@store/useExplorerStore.js'
import { useISA95Store, ISA95_LEVELS } from '@store/useISA95Store.js'
import { resolve_isa95 } from '@/lib/access/i3x-access.js'
import I3xAccessButton from '@components/Access/I3xAccessButton.vue'

const ISA95_LEVEL_TYPE = 'isa95-level'

const store = useExplorerStore()
const isa95 = useISA95Store()
onMounted(() => isa95.start())

const nodeOf = id => store.nodes.get(id)?.node ?? null

/* Names of the ISA-95 levels from the top down to `id`. */
function chainTo (id) {
  const chain = []
  for (let n = nodeOf(id); n && n.typeElementId === ISA95_LEVEL_TYPE; n = nodeOf(n.parentId))
    chain.unshift(n.displayName)
  return chain
}

const selected = computed(() => store.selectedNode)
const isLevel = computed(() => selected.value?.typeElementId === ISA95_LEVEL_TYPE)
const isDevice = computed(() => !isLevel.value
  && nodeOf(selected.value?.parentId)?.typeElementId === ISA95_LEVEL_TYPE)

const levelChain = computed(() => isLevel.value ? chainTo(selected.value.elementId) : [])
const levelNodes = computed(() => resolve_isa95(isa95.data, levelChain.value))
const levelMatched = computed(() => levelChain.value.length > 0
  && levelNodes.value.length === levelChain.value.length)

const deviceVia = computed(() => isDevice.value
  ? resolve_isa95(isa95.data, chainTo(selected.value.parentId))
  : [])
</script>

<template>
  <div v-if="isDevice" class="p-4 border-t">
    <I3xAccessButton :target="selected.elementId" device :via="deviceVia" noun="device"
                     :name="selected.displayName" :path="chainTo(selected.parentId).join(' / ')"/>
  </div>
  <template v-else-if="isLevel && isa95.ready">
    <div v-if="levelMatched" class="p-4 border-t">
      <I3xAccessButton :target="levelNodes.at(-1).uuid"
                       :via="levelNodes.slice(0, -1)"
                       :noun="(ISA95_LEVELS[levelNodes.length - 1] ?? 'level').toLowerCase()"
                       :name="levelNodes.at(-1).name"
                       :path="levelChain.join(' / ')"/>
    </div>
    <div v-else class="p-4 text-sm text-gray-500 border-t">
      This level's name does not match the ISA-95 vocabulary, so i3X access cannot be granted on it.
      Add the name, or an alias, on the ISA-95 page.
    </div>
  </template>
</template>

<!--
  - ACS Admin
  - The console's own actions on the object selected in the i3X Explorer
  - Copyright 2026 University of Sheffield
  -->

<!-- Any object can be added to the Live Activity monitor. An ISA-95
     level gets i3X access, granted on its vocabulary node; a device gets
     i3X access and a link to build a dataset from it. Other objects are
     read with their device, so they get neither. -->
<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { useISA95Store, ISA95_LEVELS } from '@store/useISA95Store.js'
import { useMonitorStore } from '@store/useMonitorStore.js'
import { resolve_isa95 } from '@/lib/access/i3x-access.js'
import I3xAccessButton from '@components/Access/I3xAccessButton.vue'

const props = defineProps({
  /* classify_selection() of the Explorer's selection. */
  selection: { type: Object, required: true },
})

const isa95 = useISA95Store()
const monitor = useMonitorStore()
const router = useRouter()
onMounted(() => isa95.start())

const object = computed(() => props.selection.object)
const kind = computed(() => props.selection.kind)
const path = computed(() => props.selection.levels.join(' / '))

const monitored = computed(() => monitor.items.has(object.value.elementId))

/* The ISA-95 nodes for the levels, top first, as far as the names match. */
const levelNodes = computed(() => resolve_isa95(isa95.data, props.selection.levels))
const levelMatched = computed(() => levelNodes.value.length === props.selection.levels.length)
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 min-h-9">
    <div class="flex items-center gap-2 min-w-0 mr-auto">
      <span class="text-sm font-medium truncate" :title="object.elementId">{{ object.displayName }}</span>
      <span v-if="path && kind === 'device'" class="text-xs text-gray-500 truncate">in {{ path }}</span>
    </div>

    <Button variant="outline" size="sm" class="gap-2" :disabled="monitored"
            :title="monitored ? 'Already in Live Activity' : 'Watch this object\'s values in Live Activity'"
            @click="monitor.subscribe(object.elementId, object.displayName)">
      <i class="fa-solid fa-eye text-sm"></i>
      <span>{{ monitored ? 'Monitoring' : 'Monitor' }}</span>
    </Button>

    <template v-if="kind === 'device'">
      <I3xAccessButton :target="object.elementId" device
                       :via="levelNodes" noun="device"
                       :name="object.displayName" :path="path"/>
      <Button variant="outline" size="sm" class="gap-2"
              @click="router.push({ path: '/datasets/new', query: { devices: object.elementId } })">
        <i class="fa-solid fa-database text-sm"></i>
        <span>Build dataset</span>
      </Button>
    </template>

    <template v-else-if="kind === 'level' && isa95.ready">
      <I3xAccessButton v-if="levelMatched"
                       :target="levelNodes.at(-1).uuid"
                       :via="levelNodes.slice(0, -1)"
                       :noun="(ISA95_LEVELS[levelNodes.length - 1] ?? 'level').toLowerCase()"
                       :name="levelNodes.at(-1).name"
                       :path="path"/>
      <span v-else class="text-xs text-gray-500"
            title="Add the name, or an alias, on the ISA-95 page.">
        This level's name is not in the ISA-95 vocabulary, so i3X access cannot be granted on it.
      </span>
    </template>
  </div>
</template>

<!--
  - ACS Admin
  - ISA-95 hierarchy quick-select panel for the device sidebar.
  - Copyright 2026 University of Sheffield AMRC
  -->

<template>
  <template v-if="show">
    <div class="flex items-center justify-between gap-2 p-4 border-b">
      <div class="font-semibold text-lg">ISA-95 Hierarchy</div>
    </div>
    <div class="space-y-3 p-4">
      <div v-for="(level, index) in ISA95_LEVELS" :key="level">
        <div class="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
          {{ level }}
        </div>
        <Combobox
            :model-value="get_value(level)"
            @update:model-value="(v) => on_select(level, v, index)"
            :reset-search-term-on-select="true"
        >
          <ComboboxAnchor class="w-full relative flex items-center">
            <ComboboxInput
                :display-value="(v) => v ?? ''"
                :placeholder="parent_not_set(index) ? `Set ${ISA95_LEVELS[index - 1]} first` : `Select ${level}...`"
                :disabled="parent_not_set(index)"
                class="bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <ComboboxTrigger class="absolute right-2" :disabled="parent_not_set(index)">
              <i class="fa-solid fa-chevron-down text-xs text-gray-400"/>
            </ComboboxTrigger>
          </ComboboxAnchor>
          <ComboboxList class="w-[var(--reka-popper-anchor-width)]">
            <ComboboxEmpty>No results</ComboboxEmpty>
            <ComboboxItem
                v-for="opt in get_options(level, index)"
                :key="opt.uuid"
                :value="opt.name"
                :text-value="`${opt.name} ${opt.aliases.join(' ')}`"
            >
              {{ opt.name }}
            </ComboboxItem>
          </ComboboxList>
        </Combobox>
      </div>
    </div>
  </template>
</template>

<script>
import { v4 as uuidv4 } from 'uuid'

import { ISA95_LEVELS, useISA95Store } from '@/store/useISA95Store.js'
import {
    Combobox, ComboboxAnchor, ComboboxEmpty,
    ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger,
} from '@/components/ui/combobox'

/* Schemas for the objects this panel writes into.
 *
 * An object in an origin map is only recognisable downstream if it carries
 * the Schema_UUID of the schema it instantiates. The Edge Agent config
 * generator emits a `<path>/Schema_UUID` tag only where the origin map has
 * one, and the UNS ingester finds the ISA-95 values by looking for exactly
 * the Hierarchy schema's UUID and then reading its siblings. Without these
 * the objects are anonymous: their values reach the birth certificate as
 * loose metrics that nothing downstream can interpret. */
const DEVICE_INFORMATION_SCHEMA = '2dd093e9-1450-44c5-be8c-c0d78e48219b'
const HIERARCHY_SCHEMA          = '84ac3397-f3a2-440a-99e5-5bb9f6a75091'
const METRIC_SCHEMA             = 'b16275f1-e443-4c41-a482-fcbdfbd20769'

export default {
    name: 'ISA95HierarchyPanel',

    components: {
        Combobox, ComboboxAnchor, ComboboxEmpty,
        ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger,
    },

    emits: ['change'],

    setup () {
        return {
            isa95: useISA95Store(),
            ISA95_LEVELS,
        }
    },

    props: {
        device: {
            required: true,
            type: Object,
        },
        schema: {
            required: false,
            type: Object,
            default: null,
        },
    },

    mounted () {
        this.isa95.start()
    },

    computed: {
        /* Show the panel only when:
         *  1. ISA-95 vocabulary has been configured (at least one enterprise exists), and
         *  2. The device schema references the Device Information schema (UUID
         *     2dd093e9-1450-44c5-be8c-c0d78e48219b), which is the sub-schema that
         *     contains ISA95_Hierarchy. The raw schema uses $ref links so we check
         *     by scanning the serialised schema for that UUID string. */
        show () {
            if (this.isa95.enterprises.length === 0) return false
            if (!this.schema?.schema) return false
            return JSON.stringify(this.schema.schema)
                .includes('2dd093e9-1450-44c5-be8c-c0d78e48219b')
        },

        hierarchy () {
            return this.device?.deviceInformation?.originMap
                ?.Device_Information?.ISA95_Hierarchy ?? {}
        },
    },

    methods: {
        /* Give an origin map object its schema identity, once. Existing
         * values are left alone so re-selecting a level cannot churn an
         * Instance_UUID that downstream consumers may already have seen. */
        stamp (obj, schema_uuid) {
            if (!obj.Schema_UUID) obj.Schema_UUID = schema_uuid
            if (!obj.Instance_UUID) obj.Instance_UUID = uuidv4()
        },

        get_value (level) {
            return this.hierarchy[level]?.Value ?? null
        },

        parent_not_set (index) {
            if (index === 0) return false
            return !this.get_value(ISA95_LEVELS[index - 1])
        },

        get_options (level, index) {
            if (index === 0) return this.isa95.enterprises

            const parent_level = ISA95_LEVELS[index - 1]
            const parent_value = this.get_value(parent_level)
            if (!parent_value) return []

            const parent_node = this.isa95.find_by_name(parent_level, parent_value)
            if (!parent_node) return []

            return this.isa95.children_of(parent_node.uuid)
        },

        on_select (level, new_value, level_index) {
            /* Mutate device.deviceInformation.originMap in place so that the
             * panel's own display (get_value / get_options) updates immediately.
             * We also emit the payload so that OriginMapEditor can apply the
             * same change to its own this.model — the object that actually gets
             * saved — and trigger a tree re-render.  Doing both is safe: if both
             * point at the same reference (the common case) the second mutation
             * is idempotent; if they've diverged (Pinia refresh race) both
             * copies end up correct. */
            const origin_map = this.device.deviceInformation.originMap
            if (origin_map) {
                if (!origin_map.Device_Information)
                    origin_map.Device_Information = {}
                if (!origin_map.Device_Information.ISA95_Hierarchy)
                    origin_map.Device_Information.ISA95_Hierarchy = {}

                /* Stamp the schema on each object we create. The metric
                 * editor does this for objects reached by selecting a metric
                 * (see OriginMapEditor's stamping of the ancestor chain), but
                 * this panel writes straight into the model and bypasses that
                 * path, so it has to do the same job itself. Missing these,
                 * the values are published as loose metrics and the UNS
                 * ingester never recognises the hierarchy at all. */
                this.stamp(origin_map.Device_Information,
                    DEVICE_INFORMATION_SCHEMA)
                this.stamp(origin_map.Device_Information.ISA95_Hierarchy,
                    HIERARCHY_SCHEMA)

                const hierarchy = origin_map.Device_Information.ISA95_Hierarchy
                if (!hierarchy[level]) hierarchy[level] = {}
                hierarchy[level].Value = new_value
                if (!hierarchy[level].Sparkplug_Type)
                    hierarchy[level].Sparkplug_Type = 'String'
                /* Metrics carry a Schema_UUID but no Instance_UUID, matching
                 * how the metric editor stamps them. */
                if (!hierarchy[level].Schema_UUID)
                    hierarchy[level].Schema_UUID = METRIC_SCHEMA
                for (const lower of ISA95_LEVELS.slice(level_index + 1)) {
                    if (hierarchy[lower]?.Value !== undefined)
                        hierarchy[lower].Value = null
                }
            }

            this.$emit('change', { level, value: new_value, level_index })
        },
    },
}
</script>

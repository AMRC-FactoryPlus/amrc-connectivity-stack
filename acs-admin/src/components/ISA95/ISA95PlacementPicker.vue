<!--
  - ACS Admin
  - Cascading pickers that choose a device's ISA-95 placement.
  - Copyright 2026 University of Sheffield AMRC
  -->

<template>
  <div class="space-y-3">
    <div v-for="l in levels" :key="l.level">
      <div class="flex items-center justify-between mb-1">
        <label class="text-xs font-medium text-gray-500 uppercase tracking-wide">
          {{ l.level }}<span v-if="l.index === 0 && required" class="text-red-500"> *</span>
        </label>
        <button v-if="l.index > 0 && l.value && !disabled"
            type="button"
            class="text-xs text-gray-400 hover:text-gray-900"
            :title="`Clear ${l.level} and the levels below it`"
            @click="clear(l.index)"
        >
          Clear
        </button>
      </div>
      <Combobox
          :model-value="l.value"
          @update:model-value="(v) => pick(l.index, v)"
          :reset-search-term-on-select="true"
          :disabled="!l.enabled"
      >
        <ComboboxAnchor class="w-full relative flex items-center">
          <ComboboxInput
              :display-value="(v) => name_of(v)"
              :placeholder="l.placeholder"
              :disabled="!l.enabled"
              class="bg-white pr-8 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <ComboboxTrigger class="absolute right-2" :disabled="!l.enabled">
            <i class="fa-solid fa-chevron-down text-xs text-gray-400"/>
          </ComboboxTrigger>
        </ComboboxAnchor>
        <ComboboxList class="w-[var(--reka-popper-anchor-width)]">
          <ComboboxEmpty>No results</ComboboxEmpty>
          <ComboboxItem
              v-for="opt in l.options"
              :key="opt.uuid"
              :value="opt.uuid"
              :text-value="`${opt.name} ${opt.aliases.join(' ')}`"
          >
            {{ opt.name }}
          </ComboboxItem>
        </ComboboxList>
      </Combobox>
    </div>
  </div>
</template>

<script>
import { ISA95_LEVELS, useISA95Store } from '@/store/useISA95Store.js'
import { placement_options } from '@/lib/isa95-placement.js'
import {
    Combobox, ComboboxAnchor, ComboboxEmpty,
    ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger,
} from '@/components/ui/combobox'

const article = level => /^[AEIOU]/.test(level) ? 'an' : 'a'

export default {
    name: 'ISA95PlacementPicker',

    components: {
        Combobox, ComboboxAnchor, ComboboxEmpty,
        ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger,
    },

    emits: ['update:modelValue'],

    props: {
        /* The chosen nodes, Enterprise first. The placement is the
         * last one. */
        modelValue: {
            type: Array,
            default: () => [],
        },
        disabled: {
            type: Boolean,
            default: false,
        },
        /* Mark the Enterprise as required. */
        required: {
            type: Boolean,
            default: false,
        },
    },

    setup () {
        return {
            isa95: useISA95Store(),
        }
    },

    mounted () {
        this.isa95.start()
    },

    computed: {
        /* One entry per level: its value, what it offers, and whether
         * it can be used yet. */
        levels () {
            const vocab = this.isa95.vocabulary
            return ISA95_LEVELS.map((level, index) => {
                const parent = index === 0 ? null : this.modelValue[index - 1]
                const options = index > 0 && !parent
                    ? []
                    : placement_options(vocab, parent)

                let placeholder
                if (index > 0 && !parent)
                    placeholder = `Choose ${article(ISA95_LEVELS[index - 1])} ${ISA95_LEVELS[index - 1]} first`
                else if (!options.length)
                    placeholder = index === 0
                        ? 'No Enterprises in the vocabulary'
                        : `No ${level} under ${this.name_of(parent)}`
                else
                    placeholder = `Choose ${article(level)} ${level}`

                return {
                    level,
                    index,
                    value:      this.modelValue[index] ?? null,
                    options,
                    placeholder,
                    enabled:    !this.disabled && options.length > 0,
                }
            })
        },
    },

    methods: {
        name_of (uuid) {
            if (!uuid) return ''
            return this.isa95.vocabulary.nodes.get(uuid)?.name ?? uuid
        },

        pick (index, uuid) {
            if (!uuid || uuid === this.modelValue[index]) return
            this.$emit('update:modelValue', [...this.modelValue.slice(0, index), uuid])
        },

        clear (index) {
            this.$emit('update:modelValue', this.modelValue.slice(0, index))
        },
    },
}
</script>

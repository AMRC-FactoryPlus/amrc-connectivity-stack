<!--
  - ACS Admin
  - Cascading pickers that choose a device's ISA-95 placement. A level
  - that has no match for the search can be created from here, after a
  - check for similar nodes.
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
              @update:model-value="t => terms[l.index] = t"
          />
          <ComboboxTrigger class="absolute right-2" :disabled="!l.enabled">
            <i class="fa-solid fa-chevron-down text-xs text-gray-400"/>
          </ComboboxTrigger>
        </ComboboxAnchor>
        <ComboboxList class="w-[var(--reka-popper-anchor-width)]">
          <ComboboxEmpty v-if="!l.create">
            <template v-if="l.term && !l.canCreate && l.parentName !== null">
              <div>No {{ l.level }} matches "{{ l.term }}"{{ l.parentName ? ` under ${l.parentName}` : '' }}</div>
              <div class="mt-1 text-xs text-gray-500 font-normal">
                You can place devices but not add nodes. Ask someone who can edit the ISA-95 hierarchy to add this {{ l.level }}.
              </div>
            </template>
            <template v-else-if="!l.options.length && l.canCreate">
              No {{ l.level }}{{ l.parentName ? ` under ${l.parentName}` : '' }} yet. Type a name to create one.
            </template>
            <template v-else>No results</template>
          </ComboboxEmpty>
          <ComboboxItem
              v-for="opt in l.options"
              :key="opt.uuid"
              :value="opt.uuid"
              :text-value="`${opt.name} ${opt.aliases.join(' ')}`"
          >
            {{ opt.name }}
          </ComboboxItem>
          <template v-if="l.create">
            <div class="px-2 py-1.5 text-xs text-gray-500">
              No {{ l.level }} matches "{{ l.term }}"{{ l.parentName ? ` under ${l.parentName}` : '' }}
            </div>
            <ComboboxItem :value="CREATE" :text-value="l.term" class="text-blue-700 gap-2 justify-start text-left">
              <i class="fa-solid fa-plus fa-xs"></i>
              <span>Create {{ l.level }} "{{ l.term }}"{{ l.parentName ? ` under ${l.parentName}` : '' }}</span>
            </ComboboxItem>
          </template>
        </ComboboxList>
      </Combobox>

      <div v-if="warn && warn.index === l.index && warn.matches.length" class="mt-2">
        <DuplicateWarning
            :matches="warn.matches"
            :level="l.level"
            verb="create"
            action-label="Use this"
            :compact="compact"
            :busy="busy"
            @pick="useExisting"
            @confirm="createNode"
            @cancel="cancelWarning"/>
      </div>
      <label v-if="alias && alias.index === l.index" class="mt-2 flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
        <input type="checkbox" class="mt-0.5 accent-slate-900" :checked="alias.on" :disabled="busy" @change="toggleAlias">
        <span>Add "{{ alias.text }}" as an alias of {{ name_of(alias.uuid) }}, so the next search finds it</span>
      </label>
      <div v-if="created && created.index === l.index" class="mt-2 flex items-start gap-2 text-xs text-green-700" role="status">
        <i class="fa-solid fa-check mt-0.5"></i><span>{{ created.text }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'
import { UUIDs, isa95_value_problem } from '@amrc-factoryplus/service-client'

import { ISA95_LEVELS, ISA95_LEVEL_CLASSES, useISA95Store } from '@/store/useISA95Store.js'
import { useAccessStore } from '@/store/useAccessStore.js'
import { useDeviceStore } from '@/store/useDeviceStore.js'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { placement_chain, placement_options } from '@/lib/isa95-placement.js'
import {
  add_alias, create_node, device_counts, level_plural, similar_nodes,
} from '@/lib/isa95-hierarchy.js'
import DuplicateWarning from '@/components/ISA95/DuplicateWarning.vue'
import {
    Combobox, ComboboxAnchor, ComboboxEmpty,
    ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger,
} from '@/components/ui/combobox'

const article = level => /^[AEIOU]/.test(level) ? 'an' : 'a'

/* The value of the "Create ..." option. Not a UUID, so it can't clash. */
const CREATE = '__create__'

export default {
    name: 'ISA95PlacementPicker',

    components: {
        Combobox, ComboboxAnchor, ComboboxEmpty,
        ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger,
        DuplicateWarning,
    },

    /* `settling` is true while a duplicate warning is open, so a form
     * around the picker can hold off saving a half-made placement. */
    emits: ['update:modelValue', 'settling'],

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
        /* Tighter spacing for the device sidebar. */
        compact: {
            type: Boolean,
            default: false,
        },
    },

    setup () {
        return {
            CREATE,
            isa95: useISA95Store(),
            access: useAccessStore(),
            devices: useDeviceStore(),
            s: useServiceClientStore(),
        }
    },

    data () {
        return {
            /* The search text typed at each level. */
            terms: {},
            /* The duplicate check: { index, typed, parent, matches }. */
            warn: null,
            /* After "Use this": { index, uuid, text, on }. */
            alias: null,
            /* After a create: { index, text }. */
            created: null,
            busy: false,
        }
    },

    mounted () {
        this.isa95.start()
    },

    watch: {
        warn (w) {
            this.$emit('settling', !!w)
        },
    },

    computed: {
        vocab () {
            return this.isa95.vocabulary
        },

        /* Device counts for the warning. Zero when the device store
         * isn't running here. */
        counts () {
            return device_counts(this.vocab, (this.devices.data ?? []).map(d => [d.uuid, d.placement]))
        },

        canEditVocab () {
            return this.access.check.write_apps(UUIDs.App.Info, UUIDs.App.ISA95Vocabulary)
        },

        /* One entry per level: its value, what it offers, and whether
         * it can be used yet. */
        levels () {
            const vocab = this.vocab
            return ISA95_LEVELS.map((level, index) => {
                const parent = index === 0 ? null : this.modelValue[index - 1]
                const reachable = index === 0 || !!parent
                const options = reachable ? placement_options(vocab, parent) : []
                const canCreate = reachable && !this.disabled && this.canCreate(level)
                const term = String(this.terms[index] ?? '').trim()
                const parentName = index === 0 ? '' : parent ? this.name_of(parent) : null

                let placeholder
                if (!reachable)
                    placeholder = `Choose ${article(ISA95_LEVELS[index - 1])} ${ISA95_LEVELS[index - 1]} first`
                else if (!options.length)
                    placeholder = canCreate
                        ? `Type to create ${article(level)} ${level}`
                        : index === 0
                            ? 'No Enterprises in the vocabulary'
                            : `No ${level} under ${parentName}`
                else
                    placeholder = `Choose ${article(level)} ${level}`

                return {
                    level,
                    index,
                    value:      this.modelValue[index] ?? null,
                    options,
                    placeholder,
                    term,
                    parentName,
                    canCreate,
                    /* Offer the create row when the list's own filter
                     * shows nothing. The test matches the combobox's:
                     * the typed text inside the name or an alias,
                     * ignoring case. Near misses such as "North-Works"
                     * get the create row, and the duplicate check then
                     * catches them. */
                    create:     canCreate && !!term && !options.some(o =>
                        `${o.name} ${o.aliases.join(' ')}`.toLowerCase().includes(term.toLowerCase())),
                    enabled:    !this.disabled && (options.length > 0 || canCreate),
                }
            })
        },
    },

    methods: {
        canCreate (level) {
            const cls = ISA95_LEVEL_CLASSES[level]
            return !!cls && this.canEditVocab && this.access.check.create_in(cls)
        },

        name_of (uuid) {
            if (!uuid) return ''
            return this.vocab.nodes.get(uuid)?.name ?? uuid
        },

        reset_notes () {
            this.warn = null
            this.alias = null
            this.created = null
        },

        pick (index, uuid) {
            if (uuid === CREATE) {
                this.startCreate(index)
                return
            }
            if (!uuid || uuid === this.modelValue[index]) return
            this.reset_notes()
            this.$emit('update:modelValue', [...this.modelValue.slice(0, index), uuid])
        },

        clear (index) {
            this.reset_notes()
            this.$emit('update:modelValue', this.modelValue.slice(0, index))
        },

        /* The create row was chosen: check the name, then check for
         * similar nodes before writing anything. */
        startCreate (index) {
            const l = this.levels[index]
            const typed = l.term
            const problem = isa95_value_problem(typed)
            this.reset_notes()
            if (problem) {
                toast.error(`"${typed}" can't be used as ${article(l.level)} ${l.level} name`, { description: `The name ${problem}.` })
                return
            }
            const parent = index === 0 ? null : this.modelValue[index - 1]
            const matches = similar_nodes(this.vocab, { level: l.level, name: typed, counts: this.counts })
            this.warn = { index, typed, parent, matches }
            if (!matches.length) this.createNode()
        },

        async createNode () {
            const w = this.warn
            if (!w || this.busy) return
            const level = ISA95_LEVELS[w.index]
            this.busy = true
            try {
                const uuid = await create_node(this.s.client.ConfigDB, this.vocab, {
                    level, name: w.typed, parent: w.parent, class_uuid: ISA95_LEVEL_CLASSES[level],
                })
                const where = w.parent ? ` under ${this.name_of(w.parent)}` : ''
                this.created = {
                    index: w.index,
                    text: w.matches.length
                        ? `Created ${level} "${w.typed}"${where}.`
                        : `Created ${level} "${w.typed}"${where}. No similar ${level_plural(level)} were found.`,
                }
                this.warn = null
                this.terms[w.index] = ''
                this.$emit('update:modelValue', [...this.modelValue.slice(0, w.index), uuid])
                this.focusLevel(w.index + 1)
            }
            catch (err) {
                console.error('Failed to create node:', err)
                toast.error(`Failed to create ${level} "${w.typed}"`, { description: err.message || 'An unexpected error occurred' })
                if (!w.matches.length) this.warn = null
            }
            finally {
                this.busy = false
            }
        },

        cancelWarning () {
            const index = this.warn?.index
            this.warn = null
            this.focusLevel(index)
        },

        /* Put focus in a level's field once it has rendered. */
        focusLevel (index) {
            this.$nextTick(() => {
                const input = this.$el.querySelectorAll('input[role=combobox]')[index]
                if (input && !input.disabled) input.focus()
            })
        },

        /* "Use this": place on the existing node, by its own path, and
         * save the typed name as an alias so the next search finds it. */
        async useExisting (uuid) {
            const w = this.warn
            const chain = placement_chain(this.vocab, { node: uuid }).map(n => n.uuid)
            const path = chain.length ? chain : [...this.modelValue.slice(0, w.index), uuid]
            this.warn = null
            this.terms[w.index] = ''
            this.$emit('update:modelValue', path)
            this.focusLevel(path.length)
            this.alias = { index: path.length - 1, uuid, text: w.typed, on: false }
            await this.toggleAlias()
        },

        async toggleAlias () {
            const a = this.alias
            if (!a || this.busy) return
            this.busy = true
            try {
                const cdb = this.s.client.ConfigDB
                if (!a.on) {
                    /* Nothing to add when the name is already known. */
                    if (await add_alias(cdb, this.vocab, a.uuid, a.text)) a.on = true
                    else this.alias = null
                }
                else {
                    const n = this.vocab.nodes.get(a.uuid)
                    await cdb.put_config(UUIDs.App.ISA95Vocabulary, a.uuid, {
                        aliases: n.aliases.filter(x => x !== a.text),
                        children: n.children,
                    })
                    a.on = false
                }
            }
            catch (err) {
                console.error('Failed to change alias:', err)
                toast.error('Failed to change the alias', { description: err.message || 'An unexpected error occurred' })
            }
            finally {
                this.busy = false
            }
        },
    },
}
</script>

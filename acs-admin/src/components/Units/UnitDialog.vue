<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - Add a unit to the engineering unit vocabulary, or edit one.
  -
  - A new unit is chosen from the UNECE table, which fixes its code and
  - so its UUID. Its symbol is how metrics write it; aliases are other
  - ways they write it. A label can mean only one unit, which ConfigDB
  - enforces, so clashes are shown before saving.
  -->

<template>
  <Dialog :open="isOpen" @update:open="handleOpen">
    <DialogContent class="sm:max-w-[600px] overflow-y-auto max-h-[90vh]">
      <DialogHeader>
        <DialogTitle>{{ isEditMode ? 'Edit Unit' : 'Add a Unit' }}</DialogTitle>
        <DialogDescription>
          {{ isEditMode
            ? 'Change how metrics write this unit.'
            : 'Add a UNECE unit to the vocabulary, written the way your metrics write it.' }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4 fix-inset">
        <!-- UNECE unit -->
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">UNECE unit <span class="text-red-500">*</span></label>
          <p v-if="pending" class="text-xs text-gray-500">
            Choose the unit that metrics written <span class="font-mono">{{ pending }}</span>
            mean. <span class="font-mono">{{ pending }}</span> becomes one of its aliases.
          </p>
          <div v-if="code" class="flex items-center gap-2 rounded-md border px-3 py-2">
            <span class="font-mono font-medium">{{ chosen?.symbol }}</span>
            <span class="truncate">{{ chosen?.name }}</span>
            <span class="font-mono text-gray-400 ml-auto">{{ code }}</span>
            <Button v-if="!isEditMode || pending" variant="ghost" size="xs" @click="clearCode">Change</Button>
          </div>
          <template v-else>
            <Input v-model="search" placeholder="Search by symbol, name or code, e.g. kWh, litre, CEL"/>
            <div v-if="results.length" class="max-h-56 overflow-y-auto rounded-md border divide-y">
              <button v-for="u in results" :key="u.code" type="button"
                  class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-100"
                  @click="chooseCode(u.code)">
                <span class="font-mono font-medium">{{ u.symbol }}</span>
                <span class="truncate">{{ u.name }}</span>
                <span class="font-mono text-gray-400 ml-auto">{{ u.code }}</span>
              </button>
            </div>
            <p v-else-if="search.trim()" class="text-xs text-gray-500">No UNECE unit matches.</p>
          </template>
          <p v-if="existing" class="text-xs text-red-500">
            {{ code }} is already in the vocabulary, written {{ existing.symbol }}. Edit that unit instead.
          </p>
        </div>

        <!-- Symbol -->
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Symbol <span class="text-red-500">*</span></label>
          <Input v-model="symbol" placeholder="e.g. kWh" class="font-mono"/>
          <p class="text-xs text-gray-500">
            How metrics write this unit. The unit picker writes it into new metrics.
          </p>
        </div>

        <!-- Name -->
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Name</label>
          <Input v-model="name" :placeholder="chosen?.name ?? 'e.g. kilowatt hour'"/>
        </div>

        <!-- Aliases -->
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Aliases</label>
          <p class="text-sm text-gray-500">Other ways metrics write this unit</p>
          <div class="flex flex-col gap-2 mt-2">
            <div v-for="(alias, index) in aliases" :key="index" class="flex gap-2">
              <Input v-model="aliases[index]" placeholder="e.g. kW·h" class="flex-1 font-mono"/>
              <Button variant="ghost" size="icon" @click="aliases.splice(index, 1)">
                <i class="fa-solid fa-trash text-gray-400"></i>
              </Button>
            </div>
            <Button variant="outline" @click="aliases.push('')" class="w-full">
              <i class="fa-solid fa-plus mr-2"></i>
              Add Alias
            </Button>
          </div>
        </div>

        <ul v-if="clashes.length" class="text-xs text-red-500 list-disc pl-4">
          <li v-for="c in clashes" :key="c.label">
            "{{ c.label }}" already means {{ c.unit.name }} ({{ c.unit.code }}).
          </li>
        </ul>
      </div>

      <DialogFooter :title="problem">
        <Button :disabled="!!problem || isSubmitting" @click="formSubmit">
          <div class="flex items-center justify-center gap-2">
            <i :class="{'fa-solid': true, 'fa-plus': !isEditMode && !isSubmitting, 'fa-save': isEditMode && !isSubmitting, 'fa-circle-notch animate-spin': isSubmitting}"></i>
            <div>{{ isSubmitting ? 'Saving...' : (isEditMode ? 'Save Changes' : 'Add Unit') }}</div>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'vue-sonner'

import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useEngUnitStore } from '@store/useEngUnitStore.js'
import { label_clashes, save_unit, unit_config } from '@/lib/eng-units.js'
import { search_unece, unece_symbol, unece_unit } from '@/lib/eng-units-unece.js'

export default {
  name: 'UnitDialog',

  setup () {
    return {
      s: useServiceClientStore(),
      units: useEngUnitStore(),
    }
  },

  components: {
    Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input,
  },

  mounted () {
    window.events.on('show-unit-dialog', this.open)
  },

  unmounted () {
    window.events.off('show-unit-dialog', this.open)
  },

  data () {
    return {
      isOpen: false,
      isSubmitting: false,
      editUuid: null,
      /* A string in use to add as an alias of the unit chosen. */
      pending: null,
      code: null,
      search: '',
      symbol: '',
      name: '',
      aliases: [],
    }
  },

  computed: {
    isEditMode () {
      return this.editUuid !== null
    },
    chosen () {
      return this.code ? unece_unit(this.code) : null
    },
    results () {
      return search_unece(this.search)
    },
    existing () {
      if (this.isEditMode || !this.code) return null
      return this.units.data.find(u => u.code === this.code) ?? null
    },
    config () {
      return unit_config(this.code, this.symbol, this.aliases)
    },
    clashes () {
      if (!this.code) return []
      return label_clashes(this.units.data, this.config)
    },
    problem () {
      if (!this.code) return 'Choose a UNECE unit'
      if (this.existing) return 'This unit is already in the vocabulary'
      if (!this.config.symbol) return 'Enter a symbol'
      if (this.clashes.length) return 'A symbol or alias already means another unit'
      return null
    },
  },

  methods: {
    /* `opts` is { unit } to edit one, { config, name } to add one
     * already chosen, { alias } to choose the unit a string means and
     * add the string to it, or nothing. */
    open (opts) {
      this.reset()
      this.units.start()
      const unit = opts?.unit
      if (unit) {
        this.editUuid = unit.uuid
        this.code = unit.code
        this.symbol = unit.symbol
        this.name = unit.name
        this.aliases = [...unit.aliases]
      }
      else if (opts?.config) {
        this.code = opts.config.code
        this.symbol = opts.config.symbol
        this.name = opts.name ?? ''
        this.aliases = [...(opts.config.aliases ?? [])]
      }
      else if (opts?.alias) {
        this.pending = opts.alias
        this.search = opts.alias
      }
      this.isOpen = true
    },

    handleOpen (open) {
      this.isOpen = open
      if (!open) this.reset()
    },

    reset () {
      this.editUuid = null
      this.pending = null
      this.code = null
      this.search = ''
      this.symbol = ''
      this.name = ''
      this.aliases = []
    },

    chooseCode (code) {
      /* A string for a unit already here is added to that unit. */
      const unit = this.pending && this.units.data.find(u => u.code === code)
      if (unit) {
        this.editUuid = unit.uuid
        this.code = code
        this.symbol = unit.symbol
        this.name = unit.name
        this.aliases = [...unit.aliases, this.pending]
        return
      }
      this.code = code
      if (!this.symbol.trim()) this.symbol = unece_symbol(code)
      if (!this.name.trim()) this.name = unece_unit(code).name
      if (this.pending && this.pending !== this.symbol && !this.aliases.includes(this.pending))
        this.aliases.push(this.pending)
    },

    clearCode () {
      if (!this.pending) {
        this.code = null
        return
      }
      const { pending, search } = this
      this.reset()
      this.pending = pending
      this.search = search
    },

    async formSubmit () {
      this.isSubmitting = true
      try {
        const name = this.name.trim() || this.chosen.name
        await save_unit(this.s.client.ConfigDB, this.config, name, !this.isEditMode)
        toast.success(this.isEditMode ? 'Unit updated' : `Added ${this.config.symbol} (${this.code})`)
        this.isOpen = false
        this.reset()
      }
      catch (err) {
        console.error('Failed to save unit:', err)
        toast.error('Failed to save unit', {
          description: err.message || 'An unexpected error occurred',
        })
      }
      finally {
        this.isSubmitting = false
      }
    },
  },
}
</script>

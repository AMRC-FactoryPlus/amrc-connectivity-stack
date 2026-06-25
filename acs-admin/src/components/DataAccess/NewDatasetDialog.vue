<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <Dialog :open="isOpen" @update:open="handle_open">
    <DialogContent class="sm:max-w-[640px] overflow-y-auto max-h-[90vh]">
      <DialogHeader>
        <DialogTitle>{{ is_edit ? 'Edit Dataset' : 'Create a New Dataset' }}</DialogTitle>
        <DialogDescription>
          {{ is_edit ? 'Update the structural definition of this dataset.' : 'Define a new dataset in the Data Access service.' }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">

        <!-- Name -->
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium">Name <span class="text-red-500">*</span></label>
          <Input v-model="name" placeholder="e.g. Morning shift — Machine 3"/>
        </div>

        <!-- Structure type -->
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Dataset Type <span class="text-red-500">*</span></label>
          <div class="grid grid-cols-3 gap-2">
            <Button
              v-for="opt in structure_options"
              :key="opt.value"
              :variant="structure_type === opt.value ? 'default' : 'outline'"
              :disabled="is_edit"
              class="h-16 whitespace-normal"
              @click="structure_type = opt.value"
            >
              <div class="flex flex-col items-start w-full gap-0.5 pl-1">
                <div class="text-sm font-semibold text-left" :class="structure_type === opt.value ? 'text-white' : ''">{{ opt.label }}</div>
                <div class="text-xs text-left opacity-70">{{ opt.desc }}</div>
              </div>
            </Button>
          </div>
        </div>

        <!-- ─── Sparkplug Source fields ─── -->
        <template v-if="structure_type === STRUCTURE_APPS.SPARKPLUG">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Sparkplug Device / Node UUID <span class="text-red-500">*</span></label>
            <Input v-model="sparkplug_source" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" class="font-mono text-sm"/>
            <p class="text-xs text-gray-500">The UUID of the Sparkplug Device or Node whose data this dataset covers.</p>
          </div>
        </template>

        <!-- ─── Session fields ─── -->
        <template v-if="structure_type === STRUCTURE_APPS.SESSION">
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium">Source Sparkplug Dataset <span class="text-red-500">*</span></label>
            <Select v-model="session_source">
              <SelectTrigger>
                <SelectValue>{{ session_source_label }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem
                    v-for="ds in sparkplug_datasets"
                    :key="ds.uuid"
                    :value="ds.uuid"
                  >
                    <div class="flex flex-col">
                      <span class="font-medium">{{ ds.name ?? ds.uuid }}</span>
                      <span class="text-xs text-gray-400 font-mono">{{ ds.uuid }}</span>
                    </div>
                  </SelectItem>
                  <div v-if="sparkplug_datasets.length === 0" class="px-2 py-2 text-sm text-gray-400">
                    No Sparkplug datasets available
                  </div>
                </SelectGroup>
              </SelectContent>
            </Select>
            <p class="text-xs text-gray-500">The Sparkplug dataset that this session is sliced from.</p>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">From <span class="text-red-500">*</span></label>
              <Input
                v-model="session_from"
                placeholder="2025-11-13T09:33:18.000Z"
                class="font-mono text-sm"
              />
              <p class="text-xs text-gray-500">ISO 8601 UTC timestamp</p>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-sm font-medium">To</label>
              <Input
                v-model="session_to"
                placeholder="2025-11-13T17:00:00.000Z (leave blank for open-ended)"
                class="font-mono text-sm"
              />
              <p class="text-xs text-gray-500">ISO 8601 UTC timestamp (optional)</p>
            </div>
          </div>
        </template>

        <!-- ─── Union fields ─── -->
        <template v-if="structure_type === STRUCTURE_APPS.UNION">
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Component Datasets</label>
            <p class="text-xs text-gray-500">Add one or more datasets to combine into this union. An empty union is valid.</p>
            <div v-for="(comp, idx) in union_components" :key="idx" class="flex gap-2 items-center">
              <Select v-model="union_components[idx]" class="flex-1">
                <SelectTrigger>
                  <SelectValue>{{ component_label(union_components[idx]) }}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem
                      v-for="ds in all_datasets_for_union"
                      :key="ds.uuid"
                      :value="ds.uuid"
                    >
                      <div class="flex flex-col">
                        <span class="font-medium">{{ ds.name ?? ds.uuid }}</span>
                        <span class="text-xs text-gray-400 font-mono">{{ ds.uuid }}</span>
                      </div>
                    </SelectItem>
                    <div v-if="all_datasets_for_union.length === 0" class="px-2 py-2 text-sm text-gray-400">
                      No datasets available
                    </div>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" @click="remove_component(idx)">
                <i class="fa-solid fa-trash text-gray-400"></i>
              </Button>
            </div>
            <Button variant="outline" class="w-full mt-1" @click="add_component">
              <i class="fa-solid fa-plus mr-2"></i> Add Component
            </Button>
          </div>
        </template>

        <p v-if="error_message" class="text-sm text-red-500">{{ error_message }}</p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="close">Cancel</Button>
        <Button :disabled="!can_submit || is_submitting" @click="submit">
          <div class="flex items-center gap-2">
            <i :class="is_submitting ? 'fa-solid fa-circle-notch animate-spin' : (is_edit ? 'fa-solid fa-save' : 'fa-solid fa-plus')"></i>
            <span>{{ is_submitting ? (is_edit ? 'Saving…' : 'Creating…') : (is_edit ? 'Save Changes' : 'Create Dataset') }}</span>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { ref, computed } from 'vue'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDataAccessStore } from '@store/useDataAccessStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { toast } from 'vue-sonner'
import { STRUCTURE_APPS, structure_label } from '@pages/DataAccess/datasetColumns.ts'

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function is_valid_uuid (str) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

function is_valid_iso (str) {
    return ISO_PATTERN.test(str) && !isNaN(Date.parse(str))
}

export default {
    name: 'NewDatasetDialog',
    emits: ['saved'],

    components: {
        Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
        Button, Input,
        Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
    },

    setup () {
        return {
            s: useServiceClientStore(),
            da: useDataAccessStore(),
            STRUCTURE_APPS,
            structure_label,
        }
    },

    data () {
        return {
            isOpen: false,
            is_edit: false,
            edit_uuid: null,

            name: '',
            structure_type: STRUCTURE_APPS.SPARKPLUG,

            // Sparkplug source fields
            sparkplug_source: '',

            // Session fields
            session_source: '',
            session_from: '',
            session_to: '',

            // Union fields
            union_components: [],

            is_submitting: false,
            error_message: '',

            structure_options: [
                { value: STRUCTURE_APPS.SPARKPLUG, label: 'Sparkplug Source', desc: 'All data from a Sparkplug device or node' },
                { value: STRUCTURE_APPS.SESSION,   label: 'Session',           desc: 'A time-bounded slice of a Sparkplug dataset' },
                { value: STRUCTURE_APPS.UNION,     label: 'Union',             desc: 'A combination of multiple datasets' },
            ],
        }
    },

    computed: {
        sparkplug_datasets () {
            return this.da.structures
                .filter(s => s.structure === STRUCTURE_APPS.SPARKPLUG)
                .map(s => ({
                    uuid: s.uuid,
                    name: this.da.datasets.find(d => d.uuid === s.uuid)?.name ?? null,
                }))
        },

        all_datasets_for_union () {
            return this.da.structures.map(s => ({
                uuid: s.uuid,
                name: this.da.datasets.find(d => d.uuid === s.uuid)?.name ?? null,
            }))
        },

        session_source_label () {
            if (!this.session_source) return 'Select a source dataset…'
            const match = this.sparkplug_datasets.find(d => d.uuid === this.session_source)
            return match ? (match.name ?? match.uuid) : this.session_source
        },

        can_submit () {
            if (!this.name.trim()) return false
            if (this.structure_type === STRUCTURE_APPS.SPARKPLUG) {
                return is_valid_uuid(this.sparkplug_source)
            }
            if (this.structure_type === STRUCTURE_APPS.SESSION) {
                if (!is_valid_uuid(this.session_source)) return false
                if (!is_valid_iso(this.session_from)) return false
                if (this.session_to && !is_valid_iso(this.session_to)) return false
                return true
            }
            if (this.structure_type === STRUCTURE_APPS.UNION) {
                return this.union_components.every(c => is_valid_uuid(c))
            }
            return false
        },
    },

    methods: {
        open (structure) {
            this.reset_form()
            if (structure) {
                this.is_edit = true
                this.edit_uuid = structure.uuid
                this.structure_type = structure.structure
                this.name = this.da.datasets.find(d => d.uuid === structure.uuid)?.name ?? ''
                this.load_config(structure)
            }
            this.isOpen = true
        },

        close () {
            this.isOpen = false
        },

        handle_open (val) {
            if (!val) {
                setTimeout(() => this.reset_form(), 300)
            }
        },

        reset_form () {
            this.isOpen = false
            this.is_edit = false
            this.edit_uuid = null
            this.name = ''
            this.structure_type = STRUCTURE_APPS.SPARKPLUG
            this.sparkplug_source = ''
            this.session_source = ''
            this.session_from = ''
            this.session_to = ''
            this.union_components = []
            this.is_submitting = false
            this.error_message = ''
        },

        load_config (structure) {
            const config = structure.config
            if (!config) return
            if (structure.structure === STRUCTURE_APPS.SPARKPLUG) {
                this.sparkplug_source = config.source ?? ''
            } else if (structure.structure === STRUCTURE_APPS.SESSION) {
                this.session_source = config.source ?? ''
                this.session_from = config.from ?? ''
                this.session_to = config.to ?? ''
            } else if (structure.structure === STRUCTURE_APPS.UNION) {
                this.union_components = Array.isArray(config) ? [...config] : []
            }
        },

        build_config () {
            if (this.structure_type === STRUCTURE_APPS.SPARKPLUG) {
                return { source: this.sparkplug_source.trim() }
            }
            if (this.structure_type === STRUCTURE_APPS.SESSION) {
                const cfg = {
                    source: this.session_source,
                    from: this.session_from.trim(),
                }
                if (this.session_to.trim()) {
                    cfg.to = this.session_to.trim()
                }
                return cfg
            }
            if (this.structure_type === STRUCTURE_APPS.UNION) {
                return this.union_components.filter(c => is_valid_uuid(c))
            }
            return null
        },

        add_component () {
            this.union_components.push('')
        },

        remove_component (idx) {
            this.union_components.splice(idx, 1)
        },

        component_label (uuid) {
            if (!uuid) return 'Select a dataset…'
            const match = this.all_datasets_for_union.find(d => d.uuid === uuid)
            return match ? (match.name ?? match.uuid) : uuid
        },

        async submit () {
            if (!this.can_submit || this.is_submitting) return
            this.is_submitting = true
            this.error_message = ''

            try {
                console.log("building config...")
                const config = this.build_config()
                console.log("config built:", config)
                let uuid = this.edit_uuid

                if (this.is_edit) {
                    console.log("updating dataset with uuid:", uuid, "structure_type:", this.structure_type, "config:", config) 
                    await this.s.client.DataAccess.update_dataset(uuid, this.structure_type, config)
                } else {
                    console.log("creating new dataset with structure_type:", this.structure_type, "config:", config)
                    uuid = await this.s.client.DataAccess.create_dataset(this.structure_type, config)
                }

                console.log("dataset saved with uuid:", uuid)
                console.log("awaiting put config...")
                // Set the name via ConfigDB Info app
                await this.s.client.ConfigDB.put_config(UUIDs.App.Info, uuid, {
                    name: this.name.trim(),
                })

                toast.success(this.is_edit ? 'Dataset updated' : 'Dataset created')
                this.$emit('saved', uuid)
                this.close()
            } catch (err) {
                console.error('Dataset save failed:', err)
                const status = err.status
                console.error("HTTP status:", status, "error message:", err.message)
                if (status === 403) {
                    this.error_message = 'You do not have permission to perform this action.'
                } else if (status === 409) {
                    this.error_message = 'The structure type conflicts with the existing dataset definition.'
                } else if (status === 422) {
                    this.error_message = 'The configuration is invalid. Please check all fields.'
                } else {
                    this.error_message = err.message ?? 'An unexpected error occurred.'
                }
            } finally {
                this.is_submitting = false
            }
        },
    },
}
</script>

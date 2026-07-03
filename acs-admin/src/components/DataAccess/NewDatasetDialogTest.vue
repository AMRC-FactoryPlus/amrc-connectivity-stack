<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <Dialog :open="isOpen" @update:open="handle_open">
    <DialogContent class="sm:max-w-[640px] overflow-y-auto max-h-[90vh]">
      <DialogHeader>
        <DialogTitle>{{ is_edit ? 'Edit Dataset' : 'Create a New Dataset Test' }}</DialogTitle>
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

        <!-- ─── Dataset components ─── -->
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Component Datasets</label>
          <p class="text-xs text-gray-500">Add one or more datasets to include. Cannot be empty.</p>
          <div v-for="(comp, idx) in dataset_components" :key="idx" class="flex gap-2 items-center pb-2 mb-4">
            <div class="flex-1 flex flex-col gap-2">
              <Popover v-model:open="dataset_components_source_open[idx]" class="flex-1">
                <PopoverTrigger as-child>
                  <Button
                    variant="outline"
                    role="combobox"
                    :aria-expanded="!!dataset_components_source_open[idx]"
                    class="flex-1 flex-grow justify-between"
                  >
                    {{ component_label(dataset_components[idx].source) }}
                    <i class="fa-solid fa-chevron-down ml-2 h-4 w-4 shrink-0 opacity-50"></i>
                  </Button>
                </PopoverTrigger>
                <PopoverContent class="w-[--reka-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Search datasets..." />
                    <CommandList>
                      <CommandEmpty>No datasets found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          v-for="ds in all_datasets_for_union"
                          :key="ds.uuid"
                          :value="ds.name ? `${ds.name} ${ds.uuid}` : ds.uuid"
                          @select="select_component(idx, ds.uuid)"
                        >
                          <div class="flex flex-col">
                            <span class="font-medium">{{ ds.name ?? ds.uuid }}</span>
                            <span class="text-xs text-gray-400 font-mono">{{ ds.uuid }}</span>
                          </div>
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <div class="flex gap-2 align-center items-center">
                <Input v-model="dataset_components[idx].from" placeholder="2026-07-03T12:00:00.000Z" class="text-sm"/>
                <span>-</span>
                <Input v-model="dataset_components[idx].to" placeholder="2026-07-03T12:00:00.000Z" class="text-sm"/>
              </div>
            </div>

            <Button variant="ghost" size="icon" @click="remove_component(idx)">
              <i class="fa-solid fa-trash text-gray-400"></i>
            </Button>
          </div>
          <Button variant="outline" class="w-full mt-1" @click="add_component">
            <i class="fa-solid fa-plus mr-2"></i> Add Component
          </Button>
        </div>

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
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Combobox, ComboboxAnchor, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
    name: 'NewDatasetDialogTest',
    emits: ['saved'],

    components: {
      Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
      Button, Input,
      Combobox, ComboboxAnchor, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxList,
      Popover, PopoverTrigger, PopoverContent,
      Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem
    },

    setup () {
        return {
            s: useServiceClientStore(),
            da: useDataAccessStore(),
            STRUCTURE_APPS,
            structure_label,
            cn
        }
    },

    data () {
        return {
            isOpen: false,
            is_edit: false,
            edit_uuid: null,

            name: '',

            // Dataset components
            dataset_components: [], // Each one is { source | source, from, to )}
            dataset_components_source_open: [],

            is_submitting: false,
            error_message: '',

            structure_options: [
                { value: STRUCTURE_APPS.SPARKPLUG, label: 'Sparkplug Source',  desc: 'All data from a Sparkplug device' },
                { value: STRUCTURE_APPS.SESSION,   label: 'Session',           desc: 'A time-bounded slice of a Sparkplug dataset' },
                { value: STRUCTURE_APPS.UNION,     label: 'Union',             desc: 'A combination of multiple datasets' },
            ],
        }
    },

    computed: {
        // This should come from a service call, as we may have permission to see datasets, but not use them in our own session
        sparkplug_datasets () {
            return this.da.structures
                .filter(s => s.structure === STRUCTURE_APPS.SPARKPLUG)
                .map(s => ({
                    uuid: s.uuid,
                    name: this.da.datasets.find(d => d.uuid === s.uuid)?.name ?? null,
                }))
        },

        // This should come from a service call, as we may have permission to see datasets, but not use them in a union
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
                if (!is_valid_uuid(this.dataset_components[0]?.source)) return false
                if (!is_valid_iso(this.dataset_components[0]?.from)) return false
                if (this.dataset_components[0]?.to && !is_valid_iso(this.dataset_components[0]?.to)) return false
                return true
            }
            if (this.structure_type === STRUCTURE_APPS.UNION) {
                return this.dataset_components.every(c => is_valid_uuid(c))
            }
            return false
        },
    },

    methods: {
        open (existingDataset) {
            this.reset_form()
            if (existingDataset) {
                this.is_edit = true
                this.edit_uuid = existingDataset.uuid
                this.structure_type = existingDataset.structure
                this.name = this.da.datasets.find(d => d.uuid === existingDataset.uuid)?.name ?? ''
                this.load_config(existingDataset)
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
            this.dataset_components = []
            this.dataset_components_source_open = this.dataset_components.map(() => false)
            this.is_submitting = false
            this.error_message = ''
        },

        load_config (existingDataset) {
            const config = existingDataset.config
            if (!config) return
            if (existingDataset.structure === STRUCTURE_APPS.SPARKPLUG) {
                this.dataset_components = [{ source: config.source ?? '' }]
            } else if (existingDataset.structure === STRUCTURE_APPS.SESSION) {
                this.dataset_components = [{ source: config.source ?? '', from: config.from ?? '', to: config.to ?? '' }]
            } else if (existingDataset.structure === STRUCTURE_APPS.UNION) {
                this.dataset_components = Array.isArray(config) ? config.map(c => ({ source: c })) : []
                this.dataset_components_source_open = this.dataset_components.map(() => false)
            }
        },

        build_config () {
            if (this.structure_type === STRUCTURE_APPS.SPARKPLUG) {
                return { source: this.dataset_components[0]?.source.trim() }
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
                return this.dataset_components.filter(c => is_valid_uuid(c))
            }
            return null
        },

        select_session_source (uuid) {
            this.session_source = uuid
            this.session_source_open = false
        },

        filtered_datasets_for_union (idx) {
            return this.all_datasets_for_union.filter(ds =>
                !this.dataset_components.some((c, i) => i !== idx && c === ds.uuid))
        },

        add_component () {
            this.dataset_components.push({source: '', from: '', to: ''})
            this.dataset_components_source_open.push(false)
        },

        remove_component (idx) {
            this.dataset_components.splice(idx, 1)
            this.dataset_components_source_open.splice(idx, 1)
        },

        select_component (idx, uuid) {
            this.dataset_components[idx].source = uuid
            this.dataset_components_source_open[idx] = false
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

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
          <Input v-model="name" placeholder="e.g. Morning shift — Machine 3" />
        </div>

        <!-- ─── Dataset components ─── -->
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Component Datasets</label>
          <p class="text-xs text-gray-500">Add one or more datasets to include. Cannot be empty. Time limits may be
            imposed, in which case a Session Dataset will be created.</p>
          <div v-for="(comp, idx) in dataset_components" :key="idx" class="flex gap-2 border-r-2 items-center pb-2 mb-4 hover:bg-gray-50">
            <div class="flex-1 flex flex-col gap-2 border-l-2 p-2">
              <Popover v-model:open="dataset_components_source_open[idx]" class="flex-1">
                <PopoverTrigger as-child>
                  <Button variant="outline" role="combobox" :aria-expanded="!!dataset_components_source_open[idx]"
                    class="flex-1 flex-grow justify-between">
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
                        <CommandItem v-for="ds in filtered_datasets_for_component(idx)" :key="ds.uuid"
                          :value="ds.name ? `${ds.name} ${ds.uuid}` : ds.uuid" @select="select_component(idx, ds.uuid)">
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
              <div class="flex gap-4 align-center justify-between items-center">
                <div class="flex-1">
                  <div class="w-full text-center border-b mb-1">From</div>
                  <div class="flex gap-2">
                    <Popover v-model:open="dataset_components_from_open[idx]">
                      <PopoverTrigger as-child>
                        <Button
                          variant="outline"
                          :class="cn(
                            'justify-start text-left font-normal flex-1',
                            !dataset_components[idx].from_date && 'text-muted-foreground',
                          )"
                          :aria-expanded="!!dataset_components_from_open[idx]"
                        >
                          <i class="fa-solid fa-calendar mr-2 h-4 w-4 shrink-0"></i>
                          {{ dataset_components[idx].from_date ? dataset_components[idx].from_date : "Pick a date" }}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent class="w-[280px] p-0">
                        <Calendar
                          v-model="dataset_components[idx].from_date"
                          @update:modelValue="on_component_from_selected(idx)"
                          :initial-focus="true"
                          :default-placeholder="dataset_components[idx].from_date || default_calendar_placeholder"
                          layout="month-and-year"
                        />
                      </PopoverContent>
                    </Popover>
                    <div class="w-[90px]">
                      <Input
                        type="time"
                        v-model="dataset_components[idx].from_time"
                        @input="update_component_iso(idx)"
                        step="1"
                        default-value="10:30"
                        class="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                        inputClass="hover:bg-gray-100 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
                <!-- <Input v-model="dataset_components[idx].from" placeholder="2026-07-03T12:00:00.000Z" class="text-sm" /> -->
                <span>-</span>
                <div class="flex-1">
                  <div class="w-full text-center border-b mb-1">To</div>
                  <div class="flex gap-2">
                    <Popover v-model:open="dataset_components_to_open[idx]">
                      <PopoverTrigger as-child>
                        <Button
                          variant="outline"
                          :class="cn(
                            'justify-start text-left font-normal flex-1',
                            !dataset_components[idx].to_date && 'text-muted-foreground',
                          )"
                          :aria-expanded="!!dataset_components_to_open[idx]"
                        >
                          <i class="fa-solid fa-calendar mr-2 h-4 w-4 shrink-0"></i>
                          {{ dataset_components[idx].to_date ? dataset_components[idx].to_date : "Pick a date" }}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent class="w-[280px] p-0">
                        <Calendar
                          v-model="dataset_components[idx].to_date"
                          @update:modelValue="on_component_to_selected(idx)"
                          :initial-focus="true"
                          :default-placeholder="dataset_components[idx].to_date || default_calendar_placeholder"
                          layout="month-and-year"
                        />
                      </PopoverContent>
                    </Popover>
                    <div class="w-[90px] hover:bg-gray-100 cursor-pointer">
                      <Input
                        type="time"
                        v-model="dataset_components[idx].to_time"
                        @input="update_component_iso(idx)"
                        step="1"
                        default-value="10:30"
                        class="bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                        inputClass="hover:bg-gray-100 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
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
            <i
              :class="is_submitting ? 'fa-solid fa-circle-notch animate-spin' : (is_edit ? 'fa-solid fa-save' : 'fa-solid fa-plus')"></i>
            <span>{{ is_submitting ? (is_edit ? 'Saving…' : 'Creating…') : (is_edit ? 'Save Changes' : 'Create Dataset')
              }}</span>
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
import { Calendar } from '@/components/ui/calendar'
import { getLocalTimeZone, today } from '@internationalized/date'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDataAccessStore } from '@store/useDataAccessStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { toast } from 'vue-sonner'
import { STRUCTURE_APPS, structure_label } from '@pages/DataAccess/datasetColumns.ts'

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function is_valid_uuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

function is_valid_iso(str) {
  return ISO_PATTERN.test(str) && !isNaN(Date.parse(str))
}

function build_iso_datetime (date, time) {
  if (!date || !time) return ''
  const normalized_time = time.length === 5 ? `${time}:00` : time
  const dt = new Date(`${date}T${normalized_time}`)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toISOString()
}

export default {
  name: 'NewDatasetDialogTest',
  emits: ['saved'],

  components: {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
    Button, Input,
    Combobox, ComboboxAnchor, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxList,
    Calendar,
    Popover, PopoverTrigger, PopoverContent,
    Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem
  },

  setup() {
    return {
      s: useServiceClientStore(),
      da: useDataAccessStore(),
      STRUCTURE_APPS,
      structure_label,
      cn
    }
  },

  data() {
    return {
      isOpen: false,
      is_edit: false,
      edit_uuid: null,

      name: '',

      // Dataset components
      dataset_components: [], // Each one is { source, from, to, from_date, from_time, to_date, to_time }
      dataset_components_source_open: [],
      dataset_components_from_open: [],
      dataset_components_to_open: [],

      default_calendar_placeholder: today(getLocalTimeZone()),

      is_submitting: false,
      error_message: '',
    }
  },

  computed: {
    // This should come from a service call, as we may have permission to see datasets, but not use them in our own session
    sparkplug_datasets() {
      return this.da.structures
        .filter(s => s.structure === STRUCTURE_APPS.SPARKPLUG)
        .map(s => ({
          uuid: s.uuid,
          name: this.da.datasets.find(d => d.uuid === s.uuid)?.name ?? null,
        }))
    },

    // This should come from a service call, as we may have permission to see datasets, but not use them in a union
    all_datasets_for_union() {
      return this.da.structures.map(s => ({
        uuid: s.uuid,
        name: this.da.datasets.find(d => d.uuid === s.uuid)?.name ?? null,
      }))
      .sort((a, b) => (a.name ?? a.uuid).localeCompare(b.name ?? b.uuid))
    },

    can_submit() {
      // Ensure we have a name
      if (!this.name.trim()) {
        console.log('cannot submit: name is empty')
        return false
      }
      // Ensure we have some components
      if (!this.dataset_components.length) {
        console.log('cannot submit: no dataset components')
        return false
      }
      // Ensure that if we have a single component, it has valid from/to if specified, otherwise it is just copying an existing Dataset
      if (this.dataset_components.length === 1 && (!is_valid_iso(this.dataset_components[0].from) || !is_valid_iso(this.dataset_components[0].to))) {
        console.log('cannot submit: single component must have valid from and to timestamps')
        return false
      }
      // Ensure all components have valid UUIDs
      if (!this.dataset_components.every(c => is_valid_uuid(c.source))) {
        console.log('cannot submit: one or more component sources are not valid UUIDs')
        return false
      }
      // Ensure all components have valid from/to if specified
      if (!this.dataset_components.every(c => (is_valid_iso(c.from) && is_valid_iso(c.to)) || (c.from == "" && c.to == ""))) {
        console.log('cannot submit: one or more component date ranges are invalid')
        return false
      }
      return true
    },
  },

  methods: {
    open(existingDataset) {
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

    close() {
      this.isOpen = false
    },

    handle_open(val) {
      if (!val) {
        setTimeout(() => this.reset_form(), 300)
      }
    },

    reset_form() {
      this.isOpen = false
      this.is_edit = false
      this.edit_uuid = null
      this.name = ''
      this.dataset_components = []
      this.dataset_components_source_open = []
      this.dataset_components_from_open = []
      this.dataset_components_to_open = []
      this.is_submitting = false
      this.error_message = ''
    },

    load_config(existingDataset) {
      const config = existingDataset.config
      if (!config) return
      if (existingDataset.structure === STRUCTURE_APPS.SPARKPLUG) {
        this.dataset_components = [{ source: config.source ?? '', from: '', to: '', from_date: null, from_time: null, to_date: null, to_time: null }]
      } else if (existingDataset.structure === STRUCTURE_APPS.SESSION) {
        const from = config.from ?? ''
        const to = config.to ?? ''
        this.dataset_components = [{
          source: config.source ?? '',
          from,
          to,
          from_date: from ? from.slice(0, 10) : null,
          from_time: from ? from.slice(11, 19) : null,
          to_date: to ? to.slice(0, 10) : null,
          to_time: to ? to.slice(11, 19) : null,
        }]
      } else if (existingDataset.structure === STRUCTURE_APPS.UNION) {
        this.dataset_components = Array.isArray(config)
          ? config.map(c => ({ source: c, from: '', to: '', from_date: null, from_time: null, to_date: null, to_time: null }))
          : []
        this.dataset_components_source_open = this.dataset_components.map(() => false)
      }
    },

    filtered_datasets_for_component(idx) {
      return this.all_datasets_for_union.filter(ds =>
        !this.dataset_components.some((c, i) => i !== idx && c.source === ds.uuid && c.from == "" && c.to == ""))
    },

    add_component() {
      this.dataset_components.push({ source: '', from: '', to: '', from_date: null, from_time: null, to_date: null, to_time: null })
      this.dataset_components_source_open.push(false)
      this.dataset_components_from_open.push(false)
      this.dataset_components_to_open.push(false)
    },

    remove_component(idx) {
      this.dataset_components.splice(idx, 1)
      this.dataset_components_source_open.splice(idx, 1)
      this.dataset_components_from_open.splice(idx, 1)
      this.dataset_components_to_open.splice(idx, 1)
    },

    select_component(idx, uuid) {
      this.dataset_components[idx].source = uuid
      this.dataset_components_source_open[idx] = false
    },

    on_component_from_selected(idx) {
      this.dataset_components_from_open[idx] = false
      this.update_component_iso(idx)
    },

    on_component_to_selected(idx) {
      this.dataset_components_to_open[idx] = false
      this.update_component_iso(idx)
    },

    update_component_iso(idx) {
      const comp = this.dataset_components[idx]
      if (!comp) return
      const from = build_iso_datetime(comp.from_date, comp.from_time)
      const to = build_iso_datetime(comp.to_date, comp.to_time)
      comp.from = from
      comp.to = to
    },

    component_label(uuid) {
      if (!uuid) return 'Select a dataset…'
      const match = this.all_datasets_for_union.find(d => d.uuid === uuid)
      return match ? (match.name ?? match.uuid) : uuid
    },

    async submit() {
      if (!this.can_submit || this.is_submitting) return
      this.is_submitting = true
      this.error_message = ''

      try {
        // The Dialog allows the user to build a Dataset which may contain multiple Datasets.
        if (this.dataset_components.length > 1) {
          // A Union Dataset is required to combine the components.
          // This logic needs to assess the requirements and build each Dataset (if required).
          // When all Datasets are built, the final Dataset is created or updated with the correct configuration.
          const component_uuids = [];
          for (const comp of this.dataset_components) {
            // comp: { source: 'uuid', from?: 'iso', to?: 'iso' }
            console.log("Processing component:", comp)
            if (!this.da.datasets.some(d => d.uuid === comp.source) && !this.da.structures.some(s => s.uuid === comp.source)) {
              this.error_message = `Component Dataset source ${comp.source} does not exist.`
              throw new Error(this.error_message)
            }
            if (is_valid_iso(comp.from) && is_valid_iso(comp.to)) {
              // Session to create
              const uuid = await this.s.client.DataAccess.create_dataset(STRUCTURE_APPS.SESSION, comp)
              // We want to push the UUID of the newly created Session Dataset into the component_uuids array.
              component_uuids.push(uuid)

              console.log("Component Session Dataset [", component_uuids.length, "] saved with uuid:", uuid)
              console.log("Awaiting put config...")
              // Set the name via ConfigDB Info app
              await this.s.client.ConfigDB.put_config(UUIDs.App.Info, uuid, {
                  // Set the name of the component to "Name (Session Component N)".
                  name: `${this.name.trim()} (Session Component ${component_uuids.length})`,
              })
            } else {
              // Straight Dataset to embed
              component_uuids.push(comp.source)
              console.log("Component Dataset [", component_uuids.length, "] added with uuid:", comp.source)
            }
          }

          // All components are now ready, create the Union Dataset.
          const uuid = await this.s.client.DataAccess.create_dataset(STRUCTURE_APPS.UNION, component_uuids)

          console.log("Union Dataset saved with uuid:", uuid)
          console.log("Awaiting put config...")
          // Set the name via ConfigDB Info app
          await this.s.client.ConfigDB.put_config(UUIDs.App.Info, uuid, {
              name: this.name.trim(),
          })
        } else if (this.dataset_components.length === 1) {
          // Only one component, no need for a Union Dataset.
          const comp = this.dataset_components[0];
          console.log("Processing only component:", comp)
          if (is_valid_iso(comp.from) && is_valid_iso(comp.to)) {
            // Session to create
            const uuid = await this.s.client.DataAccess.create_dataset(STRUCTURE_APPS.SESSION, comp)

            console.log("Session Dataset saved with uuid:", uuid)
            console.log("Awaiting put config...")
            // Set the name via ConfigDB Info app
            await this.s.client.ConfigDB.put_config(UUIDs.App.Info, uuid, {
              name: this.name.trim(),
            })
          } else {
            // No need to make a new Dataset that is just a copy of an existing one.
          }
        } else {
          this.error_message = 'No valid components to create a dataset.'
          throw new Error(this.error_message)
        }

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

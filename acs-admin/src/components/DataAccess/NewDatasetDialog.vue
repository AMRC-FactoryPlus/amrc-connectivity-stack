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
          <Input v-model="name" placeholder="e.g. Morning shift — Machine 3" />
        </div>

        <!-- Tabs -->
        <Tabs v-model="active_tab">
          <TabsList class="grid w-full grid-cols-2">
            <TabsTrigger value="sparkplug" :disabled="is_edit && active_tab !== 'sparkplug'">Sparkplug Source</TabsTrigger>
            <TabsTrigger value="components" :disabled="is_edit && active_tab !== 'components'">Component Datasets</TabsTrigger>
          </TabsList>

          <!-- ─── Sparkplug Source Tab ─── -->
          <TabsContent value="sparkplug" class="flex flex-col gap-2 mt-3">
            <label class="text-sm font-medium">Sparkplug Device <span class="text-red-500">*</span></label>
            <Popover v-model:open="sparkplug_source_open">
              <PopoverTrigger as-child>
                <Button variant="outline" role="combobox" :aria-expanded="!!sparkplug_source_open" class="w-full justify-between">
                  {{ sparkplug_device_label }}
                  <i class="fa-solid fa-chevron-down ml-2 h-4 w-4 shrink-0 opacity-50"></i>
                </Button>
              </PopoverTrigger>
              <PopoverContent class="w-[--reka-popover-trigger-width] p-0">
                <Command>
                  <CommandInput placeholder="Search devices..." />
                  <CommandList>
                    <CommandEmpty>No devices found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        v-for="device in available_devices"
                        :key="device.uuid"
                        :value="device.name ? `${device.name} ${device.uuid}` : device.uuid"
                        @select="select_sparkplug_source(device.uuid)"
                      >
                        <div class="flex flex-col">
                          <span class="font-medium">{{ device.name ?? device.uuid }}</span>
                          <span class="text-xs text-gray-400 font-mono">{{ device.uuid }}</span>
                        </div>
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <p class="text-xs text-gray-500">The Sparkplug device whose data this dataset covers.</p>
          </TabsContent>

          <!-- ─── Component Datasets Tab ─── -->
          <TabsContent value="components" class="flex flex-col gap-2 mt-3">
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
                          <div class="flex items-start justify-between w-full gap-2">
                            <div class="flex flex-col min-w-0">
                              <span class="font-medium truncate">{{ ds.name ?? ds.uuid }}</span>
                              <span class="text-xs text-gray-400 font-mono">{{ ds.uuid }}</span>
                            </div>
                            <span v-if="ds.structure" class="text-xs text-gray-500 whitespace-nowrap mt-0.5 shrink-0">{{ structure_label(ds.structure) }}</span>
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
          </TabsContent>
        </Tabs>

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Combobox, ComboboxAnchor, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { getLocalTimeZone, today } from '@internationalized/date'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { useDataAccessStore } from '@store/useDataAccessStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
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
    Tabs, TabsContent, TabsList, TabsTrigger,
    Combobox, ComboboxAnchor, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxList,
    Calendar,
    Popover, PopoverTrigger, PopoverContent,
    Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem
  },

  setup() {
    return {
      s: useServiceClientStore(),
      da: useDataAccessStore(),
      d: useDeviceStore(),
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
      active_tab: 'sparkplug',

      // Sparkplug source fields
      sparkplug_source: '',
      sparkplug_source_open: false,

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

  async mounted() {
    await this.d.start()
  },

  unmounted() {
    this.d.stop()
  },

  computed: {
    available_devices() {
      return Array.isArray(this.d.data)
        ? this.d.data
            .map(dev => ({ uuid: dev.uuid, name: dev.name ?? null }))
            .sort((a, b) => (a.name ?? a.uuid).localeCompare(b.name ?? b.uuid))
        : []
    },

    sparkplug_device_label() {
      if (!this.sparkplug_source) return 'Select a device…'
      const match = this.available_devices.find(d => d.uuid === this.sparkplug_source)
      return match ? (match.name ?? match.uuid) : this.sparkplug_source
    },

    // All datasets known to the ConfigDB, regardless of whether we are allowed to embed them
    // in a Union or use them as a Session source. Used only to resolve names/structure for
    // uuids we already hold (e.g. when editing an existing dataset whose components we may
    // no longer be permitted to add).
    all_datasets_for_union() {
      return this.da.structures.map(s => ({
        uuid: s.uuid,
        name: this.da.datasets.find(d => d.uuid === s.uuid)?.name ?? null,
        structure: s.structure ?? null,
      }))
      .sort((a, b) => (a.name ?? a.uuid).localeCompare(b.name ?? b.uuid))
    },

    // Datasets we're permitted to embed directly as a Union component (IncludeInUnion).
    union_datasets() {
      const allowed = new Set(this.da.union_sources)
      return this.all_datasets_for_union.filter(ds => allowed.has(ds.uuid))
    },

    // Datasets we're permitted to use as the source of a Session (UseForSession).
    session_datasets() {
      const allowed = new Set(this.da.session_sources)
      return this.all_datasets_for_union.filter(ds => allowed.has(ds.uuid))
    },

    can_submit() {
      if (!this.name.trim()) return false

      if (this.active_tab === 'sparkplug') {
        return is_valid_uuid(this.sparkplug_source)
      }

      // components tab
      if (!this.dataset_components.length) return false
      if (this.dataset_components.length === 1 && (!is_valid_iso(this.dataset_components[0].from) || !is_valid_iso(this.dataset_components[0].to))) return false
      if (!this.dataset_components.every(c => is_valid_uuid(c.source))) return false
      if (!this.dataset_components.every(c => (is_valid_iso(c.from) && is_valid_iso(c.to)) || (c.from == "" && c.to == ""))) return false
      return true
    },
  },

  methods: {
    open(existingDataset) {
      this.reset_form()
      if (existingDataset) {
        this.is_edit = true
        this.edit_uuid = existingDataset.uuid
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
      this.active_tab = 'sparkplug'
      this.sparkplug_source = ''
      this.sparkplug_source_open = false
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
        this.active_tab = 'sparkplug'
        this.sparkplug_source = config.source ?? ''
      } else if (existingDataset.structure === STRUCTURE_APPS.SESSION) {
        this.active_tab = 'components'
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
        this.dataset_components_source_open = [false]
        this.dataset_components_from_open = [false]
        this.dataset_components_to_open = [false]
      } else if (existingDataset.structure === STRUCTURE_APPS.UNION) {
        this.active_tab = 'components'
        this.dataset_components = Array.isArray(config)
          ? config.map(c => ({ source: c, from: '', to: '', from_date: null, from_time: null, to_date: null, to_time: null }))
          : []
        this.dataset_components_source_open = this.dataset_components.map(() => false)
        this.dataset_components_from_open = this.dataset_components.map(() => false)
        this.dataset_components_to_open = this.dataset_components.map(() => false)
      }
    },

    select_sparkplug_source(uuid) {
      this.sparkplug_source = uuid
      this.sparkplug_source_open = false
    },

    filtered_datasets_for_component(idx) {
      // A lone component always becomes a Session; within a multi-component Union, a
      // component with dates set becomes a Session wrapping that source, while a bare
      // component is embedded directly - each needs the matching permission.
      const comp = this.dataset_components[idx]
      const as_session = this.dataset_components.length === 1 ||
        (is_valid_iso(comp?.from) && is_valid_iso(comp?.to))
      const source_list = as_session ? this.session_datasets : this.union_datasets

      return source_list.filter(ds =>
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
        let created_uuid = null

        if (this.active_tab === 'sparkplug') {
          const config = { source: this.sparkplug_source }
          if (this.is_edit) {
            await this.s.client.DataAccess.update_dataset(this.edit_uuid, STRUCTURE_APPS.SPARKPLUG, config)
            created_uuid = this.edit_uuid
          } else {
            created_uuid = await this.s.client.DataAccess.create_dataset(STRUCTURE_APPS.SPARKPLUG, config)
          }
          await this.s.client.ConfigDB.put_config(UUIDs.App.Info, created_uuid, {
            name: this.name.trim(),
          })
        } else {
          // Components tab — build SESSION or UNION as needed
          if (this.dataset_components.length > 1) {
            const component_uuids = []
            for (const comp of this.dataset_components) {
              if (!this.da.datasets.some(d => d.uuid === comp.source) && !this.da.structures.some(s => s.uuid === comp.source)) {
                this.error_message = `Component Dataset source ${comp.source} does not exist.`
                throw new Error(this.error_message)
              }
              if (is_valid_iso(comp.from) && is_valid_iso(comp.to)) {
                const uuid = await this.s.client.DataAccess.create_dataset(STRUCTURE_APPS.SESSION, {
                  source: comp.source, from: comp.from, to: comp.to,
                })
                component_uuids.push(uuid)
                await this.s.client.ConfigDB.put_config(UUIDs.App.Info, uuid, {
                  name: `${this.name.trim()} (Session Component ${component_uuids.length})`,
                })
              } else {
                component_uuids.push(comp.source)
              }
            }
            created_uuid = await this.s.client.DataAccess.create_dataset(STRUCTURE_APPS.UNION, component_uuids)
            await this.s.client.ConfigDB.put_config(UUIDs.App.Info, created_uuid, {
              name: this.name.trim(),
            })
          } else if (this.dataset_components.length === 1) {
            const comp = this.dataset_components[0]
            if (is_valid_iso(comp.from) && is_valid_iso(comp.to)) {
              created_uuid = await this.s.client.DataAccess.create_dataset(STRUCTURE_APPS.SESSION, {
                source: comp.source, from: comp.from, to: comp.to,
              })
              await this.s.client.ConfigDB.put_config(UUIDs.App.Info, created_uuid, {
                name: this.name.trim(),
              })
            } else {
              this.error_message = "Single component must have valid 'from' and 'to' timestamps to create a Session Dataset."
              throw new Error(this.error_message)
            }
          } else {
            this.error_message = 'No valid components to create a dataset.'
            throw new Error(this.error_message)
          }
        }

        toast.success(this.is_edit ? 'Dataset updated' : 'Dataset created')
        this.$emit('saved', created_uuid)
        this.close()
      } catch (err) {
        console.error('Dataset save failed:', err)
        const status = err.status
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

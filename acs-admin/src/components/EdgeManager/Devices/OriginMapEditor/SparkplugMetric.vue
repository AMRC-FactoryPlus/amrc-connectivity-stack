<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex flex-col mb-3">
    <div class="flex items-end justify-between gap-2 w-full mb-2 h-6">
      <div class="flex items-center gap-2 text-gray-500">
        <i class="fa-solid fa-timeline text-xs"></i>
        <div class="text-xs font-bold uppercase tracking-wide">{{isStatic ? 'Value' : 'Origin Map'}}</div>
      </div>
      <Button variant="outline" size="plain" class="px-2 text-gray-500 text-sm"
          @click="toggleMode"
      >
        {{isStatic ? 'Use Origin Map' : 'Use static value'}}
      </Button>
    </div>
    <div class="rounded-lg border border-gray-300 p-5 bg-gray-100">
      <div class="grid gap-3 2xl:grid-cols-3">
        <Control v-if="!isStatic" label="Device Address" :help="schema.properties.Address.description">
          <Input v-model="localModel.Address" placeholder="Address" icon="globe-europe"/>
        </Control>
        <Control v-if="!isStatic" label="Metric Path" :help="schema.properties.Path.description">
          <Input v-model="localModel.Path" placeholder="Path" icon="folder-tree"/>
        </Control>
        <Control v-if="isStatic" label="Static Value" :help="schema.properties.Value.description">
          <Input v-model="localModel.Value" placeholder="Value" icon="i-cursor"/>
        </Control>
        <Control label="Type" :help="schema.properties.Sparkplug_Type.description">
          <Select v-model="localModel.Sparkplug_Type">
            <SelectTrigger :class="isValidType(localModel.Sparkplug_Type, availableTypes) ? '' : 'bg-red-200'">
              <SelectValue placeholder="Select type"/>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem
                    v-for="type in availableTypes"
                    :key="type.value"
                    :value="type.value"
                >
                  {{type.title}}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Control>
      </div>
    </div>
  </div>
  <div class="grid 2xl:grid-cols-2 gap-3">
    <div class="flex flex-col">
      <div class="flex items-end justify-between gap-2 w-full mb-2 h-6">
        <div class="flex items-center gap-2 text-gray-500">
          <i class="fa-solid fa-compass-drafting text-xs"></i>
          <div class="text-xs font-bold uppercase tracking-wide">Engineering Units</div>
        </div>
      </div>
      <div class="rounded-lg border border-gray-300 p-5 ">
        <div class="grid gap-3 2xl:grid-cols-2">
          <Control label="Unit" :help="schema.properties.Eng_Unit.description" class="col-span-2">
            <Input v-model="localModel.Eng_Unit" placeholder="e.g. kWh, °C"/>
          </Control>
          <Control v-if="!isStatic" label="Low Limit" :help="schema.properties.Eng_Low.description">
            <Input
                :model-value="localModel.Eng_Low"
                @update:model-value="(val) => {localModel.Eng_Low = Number(val)}"
                type="number"
                placeholder="e.g. 0"
            />
          </Control>
          <Control v-if="!isStatic" label="High Limit" :help="schema.properties.Eng_High.description">
            <Input
                :model-value="localModel.Eng_High"
                @update:model-value="(val) => {localModel.Eng_High = Number(val)}"
                type="number"
                placeholder="e.g. 100"
            />
          </Control>
        </div>
      </div>
    </div>
    <div class="flex flex-col">
      <div class="flex items-end justify-between gap-2 w-full mb-2 h-6">
        <div class="flex items-center gap-2 text-gray-500">
          <i class="fa-solid fa-sliders text-xs"></i>
          <div class="text-xs font-bold uppercase tracking-wide">Data Processing</div>
        </div>
      </div>
      <div class="rounded-lg border border-gray-300 p-5">
        <div class="grid gap-3">
          <Control v-if="!isStatic" label="Deadband" :help="schema.properties.Deadband.description">
            <Input v-model="localModel.Deadband" placeholder="e.g. 0.1"/>
          </Control>
          <Control label="Record" :help="schema.properties.Record_To_Historian.description">
            <div @click.stop="localModel.Record_To_Historian = !localModel.Record_To_Historian"
                class="cursor-pointer flex items-center space-x-3 w-full h-10 rounded-md border border-input px-3 py-2 text-sm ring-offset-background transition-colors  data-[checked=false]:bg-red-100 data-[checked=false]:border-red-200 bg-gray-50 hover:bg-gray-100"
                :data-checked="localModel.Record_To_Historian">
              <Checkbox
                  id="record-historian"
                  v-model="localModel.Record_To_Historian"
              />
              <div class="grid ">
                <p class="text-xs text-gray-500">
                  Record this metric in the historian
                </p>
              </div>
            </div>
          </Control>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import Control from './Control.vue'
import LinkUserDialog from '@pages/AccessControl/LinkUserDialog.vue'
import GroupList from '@pages/AccessControl/Groups/GroupList.vue'
import PrincipalList from '@pages/AccessControl/Principals/PrincipalList.vue'
import PermissionList from '@pages/AccessControl/Permissions/PermissionList.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import DetailCard from '@components/DetailCard.vue'
import { Button } from '@/components/ui/button'

export default {
  name: 'SparkplugMetric',

  components: {
    DetailCard,
    Input,
    Checkbox,
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Control,
    LinkUserDialog,
    GroupList,
    PrincipalList,
    PermissionList,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    Button,
  },

  props: {
    selectedMetric: {
      required: true,
      type: Object,
    },
    model: {
      required: true,
      type: Object,
    },
    schema: {
      required: true,
      type: Object,
    },
  },

  data () {
    return {
      isStatic: false,
      localModel: {},
      activeTab: 'principals',
      isToggling: false,
    }
  },

  computed: {
    availableTypes () {
      return this.selectedMetric.schema.Sparkplug_Type.enum.map(e => ({
        title: e === '' ? 'None' : e,
        value: e,
      }))
    },

    methods () {
      return this.schema?.properties?.Method?.enum?.map(e => ({
        title: e === '' ? 'None' : e,
        value: e,
      }))
    },
  },

  watch: {
    selectedMetric: {
      handler (val) {
        this.localModel = val.model
        // Set isStatic to true if there's a Value, false if there's an Address/Path
        this.isStatic = 'Value' in val.model
      },
      immediate: true,
    },

    localModel: {
      handler (val) {
        let newObject = Object.assign({}, val)

        // Remove null or empty string properties
        Object.keys(newObject).forEach(key => {
          if (newObject[key] === null || newObject[key] === '') {
            delete newObject[key]
          }
        })

        // Check if the metric has any of the required fields (Address, Path, or Value)
        const hasRequiredFields =
          ('Address' in newObject && newObject.Address) ||
          ('Path' in newObject && newObject.Path) ||
          ('Value' in newObject && newObject.Value);

        // If no required fields, emit a special event to remove the metric
        // But only if we're not in the middle of toggling modes
        if (!hasRequiredFields && !this.isToggling) {
          this.$emit('remove-metric', this.selectedMetric.path);
          return;
        }

        this.$emit('input', newObject)
      },
      deep: true,
    },
  },

  methods: {
    toggleMode () {
      // Set the isToggling flag to prevent metric removal during mode switch
      this.isToggling = true;

      this.isStatic = !this.isStatic

      // Set default values before clearing to ensure we always have at least one required field
      if (this.isStatic) {
        // Switching to static value mode
        // Set a default Value before clearing Address and Path
        if (!this.localModel.Value) {
          this.localModel.Value = ''
        }
        // Now clear Address and Path
        this.localModel.Address = null
        this.localModel.Path = null
      } else {
        // Switching to origin map mode
        // Set default Address and Path before clearing Value
        if (!this.localModel.Address) {
          this.localModel.Address = ''
        }
        if (!this.localModel.Path) {
          this.localModel.Path = ''
        }
        // Now clear Value
        this.localModel.Value = null
      }

      // Clear the isToggling flag after a short delay to allow the watch to process
      setTimeout(() => {
        this.isToggling = false;
      }, 100);
    },
    isValidType (val, options) {
      return options.some(e => e.value === val)
    },

    get (path, onObject, delimiter = '.') {
      let schema  = onObject  // a moving reference to internal objects within obj
      const pList = path.split(delimiter)
      const len   = pList.length
      for (let i = 0; i < len - 1; i++) {
        const elem = pList[i]
        if (!schema[elem]) schema[elem] = {}
        schema = schema[elem]
      }
      return schema[pList[len - 1]]
    },

    changeTab (value) {
      this.activeTab = value
    },

    objectClicked (object) {
      // Implement your click handler here
    },
  }
}
</script>


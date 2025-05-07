<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="cluster" @update:open="handleOpen">
    <DialogContent v-if="cluster" class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Create a New Node</DialogTitle>
        <DialogDescription>Create a new node in the {{cluster.name}} cluster</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col justify-center gap-2 overflow-auto flex-1 fix-inset">
        <Input
            title="Name"
            class="max-w-sm"
            placeholder="e.g. Cell Gateway"
            v-model="v$.name.$model"
            :v="v$.name"
        />
        <div class="flex flex-col gap-1">
          <label class="text-sm font-medium" for="host">Host</label>
          <Select name="host" v-model="hostname">
            <SelectTrigger>
              <SelectValue>
                {{hostname ?? 'Floating'}}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="host in hosts" :value="host.hostname" :key="host.hostname">
                  <div class="flex items-center justify-between gap-2">
                    <div class="font-medium">{{host.hostname}}</div>
                    <div class="flex items-center justify-center gap-1.5 text-gray-400">
                      <i class="fa-solid fa-microchip text-sm"></i>
                      <div>{{host.arch}}</div>
                    </div>
                  </div>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <!--        <div class="flex flex-col gap-1">-->
        <!--          <label class="text-sm font-medium" for="host">Additional Deployments</label>-->
        <!--          <Combobox v-model="helmCharts" v-model:open="helmChartSelectorOpen" :ignore-filter="true">-->
        <!--            <ComboboxAnchor as-child>-->
        <!--              <TagsInput v-model="helmCharts" class="px-2 gap-2 w-full">-->
        <!--                <div class="flex gap-2 flex-wrap items-center">-->
        <!--                  <TagsInputItem v-for="item in helmCharts" :key="item.uuid" :value="item.name">-->
        <!--                    <TagsInputItemText/>-->
        <!--                    <TagsInputItemDelete/>-->
        <!--                  </TagsInputItem>-->
        <!--                </div>-->

        <!--                <ComboboxInput v-model="helmChartSelectorSearch" as-child>-->
        <!--                  <TagsInputInput placeholder="Search Deployments..."-->
        <!--                      class="min-w-[200px] w-full p-0 border-none focus-visible:ring-0 h-auto shadow-none"-->
        <!--                      @keydown.enter.prevent/>-->
        <!--                </ComboboxInput>-->
        <!--              </TagsInput>-->

        <!--              <ComboboxList class="w-[&#45;&#45;reka-popper-anchor-width]">-->
        <!--                <ComboboxEmpty/>-->
        <!--                <ComboboxGroup>-->
        <!--                  <ComboboxItem-->
        <!--                      v-for="chart in filteredHelmCharts" :key="chart.uuid" :value="chart"-->
        <!--                      @select.prevent="(ev) => {-->
        <!--                          helmChartSelectorSearch = ''-->
        <!--                          helmCharts.push(ev.detail.value)-->

        <!--                        if (filteredHelmCharts.length === 0) {-->
        <!--                          helmChartSelectorOpen = false-->
        <!--                        }-->
        <!--                      }"-->
        <!--                  >-->
        <!--                    {{chart.name}}-->
        <!--                  </ComboboxItem>-->
        <!--                </ComboboxGroup>-->
        <!--              </ComboboxList>-->
        <!--            </ComboboxAnchor>-->
        <!--          </Combobox>-->
        <!--        </div>-->

      </div>
      <DialogFooter :title="v$?.$silentErrors[0]?.$message">
        <Button :disabled="v$.$invalid" @click="formSubmit">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-plus"></i>
            <div>Create Node</div>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { UUIDs } from '@amrc-factoryplus/service-client'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { VisuallyHidden } from 'reka-ui'
import { Input } from '@/components/ui/input'
import useVuelidate from '@vuelidate/core'
import { helpers, required } from '@vuelidate/validators'
import { useServiceClientStore } from '@store/serviceClientStore.js'
// import { useHelmChartTemplateStore } from '@store/useHelmChartTemplateStore.js'
import { toast } from 'vue-sonner'
import { sparkplug_safe_string } from '@amrc-factoryplus/service-client/lib/sparkplug/util.js'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Combobox, ComboboxAnchor, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox'
import { TagsInput, TagsInputInput, TagsInputItem, TagsInputItemDelete, TagsInputItemText } from '@/components/ui/tags-input'

export default {

  setup () {
    return {
      v$: useVuelidate(),
      s: useServiceClientStore(),
    }
  },

  components: {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    VisuallyHidden,
    Input,
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
    Combobox,
    ComboboxAnchor,
    ComboboxEmpty,
    ComboboxGroup,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    TagsInput,
    TagsInputInput,
    TagsInputItem,
    TagsInputItemDelete,
    TagsInputItemText,
  },

  mounted () {

    // this.h.fetch()

    window.events.on('show-new-node-dialog-for-cluster', (cluster) => {
      this.cluster = cluster
    })
  },

  computed: {
    sparkplugName () {
      return sparkplug_safe_string(this.name)
    },

    hosts () {
      return [
        { hostname: 'Floating', arch: 'any' },
        ...this.cluster.status.hosts
      ]
    },

    // helmCharts () {
    //   return this.h.data
    // },

    // filteredHelmCharts () {
    //   const { contains } = useFilter({ sensitivity: 'base' })
    //
    //   const options = this.h.data.filter(i => !this.helmCharts.some(j => j.uuid === i.uuid))
    //   return this.helmChartSelectorSearch ? options.filter(option => contains(option.name, this.helmChartSelectorSearch)) : options
    // },
  },

  methods: {

    handleOpen (e) {
      if (e === false) {
        this.v$.name.$model = null
        this.v$.name.$reset()
        this.cluster  = null
        this.hostname = null
        // this.helmCharts = []
      }
    },

    async formSubmit () {
      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect) return

      try {

        // Create an entry for the device as a member of
        // UUIDs.Class.Device with name as the name
        const nodeUUID = await this.s.client.ConfigDB.create_object(UUIDs.Class.EdgeAgent)
        this.s.client.ConfigDB.put_config(UUIDs.App.Info, nodeUUID, {
          name: this.name,
        })

        const managerConfig = await this.s.client.ConfigDB.get_config(UUIDs.App.ServiceConfig, UUIDs.Service.Manager)

        let payload = {
          createdAt: new Date().toISOString(),
          name: this.sparkplugName,
          cluster: this.cluster.uuid,
          hostname: this.hostname,
          chart: managerConfig.helm.agent,
        };

        if (this.hostname === null || this.hostname === 'Floating') {
          delete payload.hostname
        }

        this.s.client.ConfigDB.put_config(UUIDs.App.EdgeAgentDeployment, nodeUUID, payload)

        toast.success(`${this.name} has been created!`)
        this.cluster = null

      }
      catch (err) {
        toast.error(`Unable to create new node in ${this.cluster.name}`)
        console.error(err)
      }
    },
  },

  data () {
    return {
      // helmChartSelectorOpen: false,
      // helmChartSelectorSearch: false,
      name: null,
      cluster: null,
      hostname: null, // helmCharts: [],
    }
  },

  validations: {
    name: {
      required,
      alphaNumUnderscoreSpace: helpers.withMessage('Letters, numbers, spaces and underscores are valid', (value) => {
        return /^[a-zA-Z0-9_ ]*$/.test(value)
      }),

    },
  },
}
</script>
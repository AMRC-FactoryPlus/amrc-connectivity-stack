<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="node" @update:open="handleOpen">
    <DialogContent v-if="node" class="sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Create a New Device</DialogTitle>
        <DialogDescription>Create a new device for the {{node.name}} node</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium">Device Name</label>
        <Input
            placeholder="e.g. My CNC Machine"
            v-model="v$.name.$model"
            :v="v$.name"
        />
            <div v-if="v$.$invalid && v$.$dirty" class="text-xs text-red-500">
              {{v$.$silentErrors[0]?.$message}}</div>
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-sm font-medium">ISA-95 Placement</label>
        <p class="text-xs text-gray-500">
          Where the device sits on the UNS. Choose at least an Enterprise.
        </p>
        <div v-if="isa95.ready && isa95.enterprises.length === 0" class="text-sm text-gray-500">
          There is no ISA-95 vocabulary yet. Create an Enterprise on the
          <RouterLink to="/isa95" class="underline hover:text-gray-900" @click="close">ISA-95 page</RouterLink>
          first.
        </div>
        <ISA95PlacementPicker v-else v-model="placement" :disabled="submitting" required class="mt-2"/>
      </div>
      <DialogFooter :title="problem">
        <Button :disabled="!!problem || submitting" @click="formSubmit">
          <div class="flex items-center justify-center gap-2">
            <i :class="submitting ? 'fa-solid fa-circle-notch animate-spin' : 'fa-solid fa-plug-circle-plus'"></i>
            <div>{{ submitting ? 'Creating...' : 'Create Device' }}</div>
          </div>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script>
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@components/ui/dialog'
import { Button } from '@components/ui/button'
import { VisuallyHidden } from 'reka-ui'
import { Input } from '@/components/ui/input'
import useVuelidate from '@vuelidate/core'
import { helpers, required } from '@vuelidate/validators'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { toast } from 'vue-sonner'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useISA95Store } from '@store/useISA95Store.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { sparkplug_safe_string } from '@amrc-factoryplus/service-client/lib/sparkplug/util.js'
import ISA95PlacementPicker from '@components/ISA95/ISA95PlacementPicker.vue'

export default {

  setup () {
    return {
      v$: useVuelidate(),
      s: useServiceClientStore(),
      d: useDeviceStore(),
      isa95: useISA95Store(),
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
    ISA95PlacementPicker,
  },

  mounted () {
    window.events.on('show-new-device-dialog-for-node', (node) => {
      this.placement = []
      this.isa95.start()
      this.node = node
    })
  },

  computed: {
    sparkplugName () {
      return sparkplug_safe_string(this.name)
    },

    /* Why the device cannot be created yet, or null. */
    problem () {
      const invalid = this.v$?.$silentErrors[0]?.$message
      if (invalid) return invalid
      if (!this.placement.length) return 'Choose at least an Enterprise'
      return null
    },
  },

  methods: {

    handleOpen (e) {
      if (e === false) this.close()
    },

    close () {
      this.v$.name.$model = null
      this.v$.name.$reset()
      this.placement = []
      this.node = null
    },

    async formSubmit () {
      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect || !this.placement.length) return

      this.submitting = true
      try {
        // Check if device name already exists
        const existingDevice = this.d.data.find(device => device.name === this.name && device.deviceInformation.node === this.node.uuid)
        if (existingDevice) {
          toast.error(`A device named "${this.name}" already exists`)
          return
        }

        // Create device with unique name
        const cdb = this.s.client.ConfigDB
        const deviceUUID = await cdb.create_object(UUIDs.Class.Device)
        await cdb.put_config(UUIDs.App.Info, deviceUUID, {
          name: this.name,
        })
        /* The placement goes in before the device information, so the
         * device is on the UNS from its first Edge Agent config. */
        await cdb.put_config(UUIDs.App.ISA95Placement, deviceUUID, {
          node: this.placement.at(-1),
        })
        await cdb.put_config(UUIDs.App.DeviceInformation, deviceUUID, {
          sparkplugName: this.sparkplugName,
          schema: null,
          connection: null,
          node: this.node.uuid,
          originMap: null,
          createdAt: new Date().toISOString(),
        })

        toast.success(`Created ${this.name}`)
        this.close()
      }
      catch (err) {
        toast.error(`Unable to create new device for ${this.node.name}`, {
          description: err.message || 'An unexpected error occurred',
        })
        console.error(err)
      }
      finally {
        this.submitting = false
      }
    },
  },

  data () {
    return {
      node: null,
      name: null,
      /* The chosen ISA-95 nodes, Enterprise first. */
      placement: [],
      submitting: false,
    }
  },

  validations: {
    name: {
      required,
      alphaNumUnderscoreSpace: helpers.withMessage('Letters, numbers, spaces and underscores are valid', (value) => {
        return /^[a-zA-Z0-9_ ]*$/.test(value)
      }),
      unique: helpers.withMessage('This device name already exists', (value, vm) => {
        if (!value) return true
        return !vm.d.data.find(device => (device.name === value && device.deviceInformation.node === vm.node.uuid))
      }),
    },
  },
}
</script>
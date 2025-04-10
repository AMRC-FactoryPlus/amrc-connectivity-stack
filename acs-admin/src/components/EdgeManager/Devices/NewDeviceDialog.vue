<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <Dialog :open="node" @update:open="handleOpen">
    <DialogContent v-if="node" class="sm:max-w-[425px]">
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
      <DialogFooter :title="v$?.$silentErrors[0]?.$message">
        <Button :disabled="v$.$invalid" @click="formSubmit">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-solid fa-plug-circle-plus"></i>
            <div>Create Device</div>
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
import { UUIDs } from '@amrc-factoryplus/service-client'
import { sparkplug_safe_string } from '@amrc-factoryplus/service-client/lib/sparkplug/util.js'

export default {

  setup () {
    return {
      v$: useVuelidate(),
      s: useServiceClientStore(),
      d: useDeviceStore(),
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
  },

  mounted () {
    window.events.on('show-new-device-dialog-for-node', (node) => {
      this.node = node
    })
  },

  computed: {
    sparkplugName () {
      return sparkplug_safe_string(this.name)
    },
  },

  methods: {

    handleOpen (e) {
      if (e === false) {
        this.v$.name.$model = null
        this.v$.name.$reset()
        this.node = null
      }
    },

    async formSubmit () {
      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect) return

      try {
        // Check if device name already exists
        const existingDevice = this.d.data.find(device => device.name === this.name && device.deviceInformation.node === this.node.uuid)
        if (existingDevice) {
          toast.error(`A device named "${this.name}" already exists`)
          return
        }

        // Create device with unique name
        const deviceUUID = await this.s.client.ConfigDB.create_object(UUIDs.Class.Device)
        this.s.client.ConfigDB.put_config(UUIDs.App.Info, deviceUUID, {
          name: this.name,
        })
        this.s.client.ConfigDB.put_config(UUIDs.App.DeviceInformation, deviceUUID, {
          sparkplugName: this.sparkplugName,
          schema: null,
          connection: null,
          node: this.node.uuid,
          originMap: null,
          createdAt: new Date().toISOString(),
        })

        toast.success(`${this.name} has been created!`)
        this.node = null
      }
      catch (err) {
        toast.error(`Unable to create new device for ${this.node.name}`)
        console.error(err)
      }
    },
  },

  data () {
    return {
      node: null,
      name: null,
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
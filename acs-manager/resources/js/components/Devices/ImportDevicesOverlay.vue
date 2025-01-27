<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <overlay
      :show="show"
      @close="$emit('close')"
      :title="config ? `Importing devices from node ${ config.sparkplug.groupId }/${config.sparkplug.edgeNode}` : 'Import Devices'">
    <template #content>

      <!--      File upload accepting JSON only -->
      <div v-if="!config" class="form-group flex flex-col gap-2">
        <label class="text-sm text-gray-600 font-bold" for="file">Select a JSON file to import:</label>
        <input type="file" id="file" @change="parseConfig" accept=".json">
      </div>
      <div v-else>
        <div v-for="connection in config.deviceConnections" class="border p-3 bg-gray-50 mb-3">
          <h2 class="mb-3">Connection: {{connection.name}}</h2>
          <div v-for="device in connection.devices" class="flex items-center justify-center gap-2">
            <div class="flex items-center justify-center gap-2 w-full">
              <Checkbox
                  @input="e => {handleCheck(e, device, connection)}"
                  :valid="{}"
                  :control="{name: device.deviceId,}"/>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-end w-full gap-2">
          <button :disabled="loading" type="button"
              class="fpl-button-brand"
              @click="importDevices">
            <div class="mr-2">Import Selected Devices</div>
            <i v-if="loading" class="animate-spin fa-sharp fa-solid fa-circle-notch"></i>
            <i v-else class="fa-sharp fa-solid fa-upload"></i>
          </button>
        </div>
      </div>
    </template>
  </overlay>
</template>

<script>

export default {
  name: 'ImportDevicesOverlay',
  components: {
    'overlay': () => import(/* webpackPrefetch: true */ '../General/Overlay.vue'),
    'Checkbox': () => import(/* webpackPrefetch: true */ '../FormControls/Checkbox.vue'),
  },
  props: {
    node: {
      required: true,
      type: Object,
    },
    show: {
      required: true,
      type: Boolean,
    },
  },

  watch: {},

  methods: {

    handleCheck (state, device, connection) {

      // If we're checking the box
      if (state) {
        // First see if there is an entry selectedConnections for the connection
        let existingConnection = this.selectedConnections.find(c => c.name === connection.name)

        // If there is not then create it and add us as the first device
        if (!existingConnection) {
          // Add the connection to the array but with an empty devices array

          let newConnection = { ...connection, ...{} }

          newConnection.devices = [device]

          this.selectedConnections.push(newConnection)
        }

        // If there is then add us under the existing connection's devices
        else {
          // Add the device to the existing connection
          existingConnection.devices.push(device)
        }
      }
      else {
        // If we're unchecking the box
        // Find the connection in the selectedConnections array
        let existingConnection = this.selectedConnections.find(c => c.name === connection.name)

        // Handle the case where we can't find the connection
        if (!existingConnection) {
          console.error('Could not find connection')
          return
        }

        // Find the device in the connection's devices array
        let existingDevice = existingConnection.devices.find(d => d.deviceId === device.deviceId)

        // Handle the case where we can't find the device
        if (!existingDevice) {
          console.error('Could not find device')
          return
        }

        // Remove the device from the connection's devices array
        existingConnection.devices = existingConnection.devices.filter(d => d.deviceId !== existingDevice.deviceId)

        // If the connection has no devices left then remove the connection from the selectedConnections array
        if (existingConnection.devices.length === 0) {
          this.selectedConnections = this.selectedConnections.filter(c => c.name !== existingConnection.name)
        }
      }

    },

    importDevices () {
      this.loading = true
      axios.post(`/api/nodes/${this.node.id}/devices/import`, {
        node_id: this.node.id,
        connections: this.selectedConnections,
      }).then((e) => {
        this.$emit('complete', e)
        window.showNotification({
          title: 'Success',
          description: 'The devices have been imported',
          type: 'success',
        })
        this.loading = false
      }).catch((error) => {
        this.loading = false
        window.showNotification({
          title: 'Error',
          description: 'There was an error importing the devices',
          type: 'error',
        })
      })
    },

    parseConfig (event) {
      const file    = event.target.files[0]
      const reader  = new FileReader()
      reader.onload = (e) => {
        this.config = JSON.parse(e.target.result)
      }
      reader.readAsText(file)
    },
  },

  data () {
    return {
      loading: false,
      config: null,
      selectedConnections: [],
    }
  },
}
</script>


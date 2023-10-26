<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="relative flex flex-col flex-grow col-span-4 bg-white p-4 pb-0 h-page">
    <div class="flex justify-start items-baseline">
      <div class="sm:w-0 sm:flex-1 mb-4">
        <h2 class="font-bold text-brand">Configuration</h2>
        <p v-if="device" class="mt-1 text-sm text-gray-500 overflow-hidden overflow-ellipsis font-bold">
          <span class="text-gray-400 font-light">for {{device.node.group.name}} / {{device.node.node_id}} /</span>
          {{device.device_id === null ? 'New Device' : device.device_id}}
        </p>
      </div>
      <div class="mt-4 flex items-center justify-between sm:mt-0 sm:ml-6 sm:flex-shrink-0 sm:justify-start">
        <div v-if="deviceLoading"
             class="inline-flex items-center px-2.5 py-1  text-sm font-medium bg-gray-100 text-gray-400">
          <div class="uppercase tracking-wide mr-1">Validating</div>
          <div class="fa-sharp fa-solid fa-circle-notch fa-spin"></div>
        </div>
        <div class="inline-flex items-center px-2.5 py-0.5 text-sm font-medium bg-red-100 text-red-500"
             v-tooltip="'Information, Connection or Schema are invalid'"
             v-else-if="!configurationValid">
          <div class="uppercase tracking-wide">Invalid</div>
        </div>
        <div class="inline-flex items-center px-2.5 py-0.5 text-sm font-medium bg-green-100 text-green-800"
             v-tooltip="'Configuration is valid and can be accessed by the Edge Agent'"
             v-else>
          <div class="uppercase tracking-wide">Valid</div>
        </div>
      </div>
    </div>
    <div class="my-2">
      <div class="hidden sm:block">
        <div class="hidden sm:block">
          <div class="border-b border-gray-200">
            <nav class="-mb-px flex" aria-label="Tabs">
              <button @mouseup="selectTab('Information')"
                      :class="[this.selectedTab === 'Information' ? 'text-brand border-brand bg-brand bg-opacity-5' : 'text-gray-500 hover:text-brand hover:border-brand', deviceInformationValid ? '' : '']"
                      class="border-transparent group inline-flex items-center py-4 px-6 border-b-2 font-medium text-sm">
                <i class="fa-sharp fa-solid fa-info mr-2 fa-fw text-base"></i>
                <span>Information</span>
              </button>
              <button @mouseup="selectTab('Connection')"
                      :class="[this.selectedTab === 'Connection' ? 'text-brand border-brand bg-brand bg-opacity-5' : 'text-gray-500 hover:text-brand hover:border-brand', deviceInformationValid ? '' : '']"
                      class="border-transparent group inline-flex items-center py-4 px-6 border-b-2 font-medium text-sm">
                <i class="fa-sharp fa-solid fa-plug mr-2 fa-fw text-base"></i>
                <span>Connection</span>
              </button>
              <button @mouseup="selectTab('Schema')"
                      :class="[this.selectedTab === 'Schema' ? 'text-brand border-brand bg-brand bg-opacity-5' : 'text-gray-500 hover:text-brand hover:border-brand', deviceInformationValid ? '' : '']"
                      class="border-transparent group inline-flex items-center py-4 px-6 border-b-2 font-medium text-sm">
                <i class="fa-sharp fa-solid fa-table-tree mr-2 fa-fw text-base"></i>
                <span>Schema</span>
              </button>
              <button @mouseup="selectTab('Files')"
                      v-if="configurationValid"
                      :class="[this.selectedTab === 'Files' ? 'text-brand border-brand bg-brand bg-opacity-5' : 'text-gray-500 hover:text-brand hover:border-brand', deviceInformationValid ? '' : '']"
                      class="border-transparent group inline-flex items-center py-4 px-6 border-b-2 font-medium text-sm">
                <i class="fa-sharp fa-solid fa-file-circle-plus mr-2 fa-fw text-base"></i>
                <span>Files</span>
              </button>
              <div class="flex-1"></div>
              <button @mouseup="maybeDeleteDevice"
                      class="text-gray-300 hover:text-red-300 border-transparent group inline-flex items-center py-4 px-6 border-b-2 font-medium text-sm">
                <i class="fa-sharp fa-solid fa-trash mr-2 fa-fw text-base"></i>
              </button>
            </nav>
          </div>
        </div>
      </div>
    </div>

    <keep-alive>
      <device-editor-information-tab v-show="selectedTab === 'Information'"
                                     :device="device"
      ></device-editor-information-tab>
    </keep-alive>
    <keep-alive>
      <device-editor-connections-tab v-show="selectedTab === 'Connection'"
                                     :device="device"
                                     :device-connections="deviceConnections"
      ></device-editor-connections-tab>
    </keep-alive>
    <keep-alive>
      <device-editor-origin-map-tab v-if="selectedTab === 'Schema'"
                                    :device="device"
                                    :device-schemas="deviceSchemas"
                                    :device-schema-versions="deviceSchemaVersions"
      ></device-editor-origin-map-tab>
      <device-editor-files-tab v-if="selectedTab === 'Files'"
                               :device="device"
                               :device-files="deviceFiles"
                               :selected-file-details="selectedFileDetails"
                               :available-file-types="availableFileTypes"
      ></device-editor-files-tab>
    </keep-alive>
  </div>
</template>

<script>

export default {
  name: 'DeviceEditor',
  props: {
    device: { required: true },
    deviceConnections: { required: true },
    deviceSchemas: { required: true },
    deviceSchemaVersions: { required: true },
    deviceFiles: { required: true },
    selectedFileDetails: { required: true },
    availableFileTypes: { required: true },
  },

  computed: {
    deviceInformationValid () {
      return this.device && this.device.device_id !== null
    },
    deviceConnectionValid () {
      return !!this?.device?.device_connection_id
    },
    deviceSchemaValid () {
      return !!this?.device?.active_origin_map?.active
    },

    configurationValid () {
      return this.deviceInformationValid && this.deviceConnectionValid && this.deviceSchemaValid
    },
  },

  methods: {
    maybeDeleteDevice() {
      if (this.deleting) return;

      window.showNotification({
        title: 'Are you sure?',
        description: 'This will delete the device and all associated data. This action is not reversible.',
        type: 'error',
        persistent: true,
        buttons: [
          {
            text: 'Delete Device', type: 'error', loadingOnClick: true, action: () => {
              this.deleteDevice()
            },
          },
          {text: 'Cancel', isClose: true}
        ],
        id: 'e9e52913-a393-4031-b37c-4704813729e4',
      });
    },

    deleteDevice () {
      this.deleting = true;
      axios.delete('/api/devices/' + this.device.id).then(() => {
        this.goto_url('/')
      })
    },
  },

  mounted () {

    // Activate the required tab on load if query string present
    const urlParams = new URLSearchParams(window.location.search)
    const tab = urlParams.get('tab')
    if (tab && this.tabs) {
      this.selectTab(tab)
      this.selectedTabContent = this.tabs.filter((e) => e.title === tab)[0] || this.tabs[0]
    }
  },

  components: {
    'device-editor-information-tab': () => import(/* webpackPrefetch: true */ './DeviceEditorInformationTab.vue'),
    'device-editor-connections-tab': () => import(/* webpackPrefetch: true */ './DeviceEditorConnectionsTab.vue'),
    'device-editor-origin-map-tab': () => import(/* webpackPrefetch: true */ './DeviceEditorOriginMapTab.vue'),
    'device-editor-files-tab': () => import(/* webpackPrefetch: true */ './DeviceEditorFilesTab.vue'),
  },

  data () {
    return {
      deviceLoading: false,
      dropdownVisible: false,
      selectedTab: 'Information',
      deleting: false,
    }
  },
}
</script>

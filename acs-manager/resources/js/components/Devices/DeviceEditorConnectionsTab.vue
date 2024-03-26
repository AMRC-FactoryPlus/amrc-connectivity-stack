<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex-grow overflow-y-auto flex flex-col items-center">
      <div v-if="selectedConnection" class="flex-grow flex flex-col overflow-y-auto p-3 pr-6 w-full">
        <div class="flex items-center justify-start mb-2">
          <button @mouseup="selectedConnection = null" class="fpl-button-secondary w-32 h-10">
            <i class="fa-sharp fa-solid fa-arrow-left mr-2"></i>
            Back
          </button>
          <h2 class="font-bold text-brand ml-3 mb-0">
            Configure Device Connection
          </h2>
        </div>
        <DeviceConnectionForm :device="device" :device-connection="selectedConnection" @close="selectedConnection = null"></DeviceConnectionForm>
      </div>
      <ColumnList v-else name="Device Connections" class="w-full" @selected=""
                  :selected-item="selectedConnection ? selectedConnection.id : null"
                  property="deviceConnections"
                  :loading="deviceConnectionsLoading" :items="deviceConnections" :show-divider="false">
        <template #actions>
          <button type="button"
                  @mouseup="createNewConnection"
                  class="fpl-button-brand mr-1">
            <div class="mr-2">New Connection</div>
            <i class="fa-sharp fa-solid fa-plus text-xs"></i>
          </button>
        </template>
        <template #empty>
          <div class="text-center pb-3 flex-grow flex flex-col items-center justify-center">
            <i class="fa-sharp fa-solid fa-plug fa-2x text-gray-500"></i>
            <h3 class="mt-2 text-sm font-medium text-gray-700">No Connections</h3>
            <p class="mt-1 text-sm text-gray-400">Get started by creating a connection to this device.</p>
            <div class="mt-6">
              <button type="button"
                      @click.stop="createNewConnection"
                      class="fpl-button-brand h-10 px-3 mr-1">
                <div class="mr-2">New Connection</div>
                <i class="fa-sharp fa-solid fa-plus text-xs"></i>
              </button>
            </div>
          </div>
        </template>
        <template v-slot:item="{ item }">
          <div class="flex items-center justify-between flex-1 px-4 py-2 text-sm truncate h-16 justify-center">
            <div class="flex flex-col overflow-hidden mr-4">
              <div class="text-gray-500 font-semibold truncate overflow-ellipsis">{{ item.name }}</div>
              <div class="text-xs text-gray-400 truncate overflow-ellipsis">Updated {{ moment(item.updated_at).fromNow() }}</div>
            </div>
            <div class="flex items-center">
              <div v-if="moment().subtract(10, 'minutes').isBefore(item.created_at)"
                   class="mr-2 inline-flex items-center px-2.5 py-0.5  text-sm font-medium bg-green-100 text-green-800">New
              </div>
              <div v-if="!item.file" class="mr-2 inline-flex items-center px-2.5 py-0.5 text-sm font-medium bg-red-200 text-red-500">Not Configured
              </div>
              <div v-if="device?.device_connection_id === item.id"
                   class="mr-2 inline-flex items-center px-2.5 py-0.5 text-sm font-medium bg-green-100 text-green-800">Active
              </div>
              <button :disabled="useChangeInProgress" v-if="item.file && device?.device_connection_id !== item.id" type="button"
                      @click.stop="use(item)"
                      class="fpl-button-secondary mr-1 px-2.5 py-0.5 disabled:opacity-50 hover:!text-gray-700">
                <div class="mr-2">Use this connection</div>
                <i v-if="!useChangeInProgress" class="fa-sharp fa-solid fa-plug text-xs"></i>
                <i v-else class="fa-sharp fa-solid fa-circle-notch animate-spin text-xs"></i>
              </button>
              <button :disabled="useChangeInProgress" type="button"
                      @click.stop="selectConnection(item)"
                      class="fpl-button-secondary mr-1 px-2.5 py-0.5 disabled:opacity-50 hover:!text-gray-700">
                <div class="mr-2">Edit</div>
                <i v-if="!useChangeInProgress" class="fa-sharp fa-solid fa-edit text-xs"></i>
                <i v-else class="fa-sharp fa-solid fa-circle-notch animate-spin text-xs"></i>
              </button>
            </div>
          </div>
        </template>
      </ColumnList>
  </div>
</template>

<script>
import moment from 'moment';

export default {
  name: 'DeviceEditorConnectionsTab',

  props: {
    device: { required: true },
    deviceConnections: { required: true },
  },

  components: {
    ColumnList: () => import(/* webpackPrefetch: true */ '../General/ColumnList.vue'),
    DeviceConnectionForm: () => import(/* webpackPrefetch: true */ '../General/DeviceConnectionForm.vue'),
  },

  methods: {
    use (connection) {
      if (this.useChangeInProgress) {return;}
      this.useChangeInProgress = true;
      axios.post(`/api/clusters/${this.device.node.cluster}/nodes/${this.device.node}/connections/${connection.id}/use`, {
        device: this.device.id
      }).then(e => {
        this.useChangeInProgress = false;
        this.requestDataReloadFor('deviceConnections');
        this.requestDataReloadFor('device');
      }).catch(error => {
        this.useChangeInProgress = false;
        if (error && error.response && error.response.status === 401) {
          this.goto_url('/login');
        }
        this.handleError(error);
      });
    },

    createNewConnection () {
      axios.post(`/api/clusters/${this.device.node.cluster}/nodes/${this.device.node.id}/connections`).then(e => {
        this.requestDataReloadFor('deviceConnections', null, null, () => {
          this.selectConnection(e.data.data);
        });
      }).catch(error => {
        if (error && error.response && error.response.status === 401) {
          this.goto_url('/login');
        }
        this.handleError(error);
      });
    },
    selectConnection (deviceConnection) {
      this.selectedConnection = deviceConnection;
    },
  },

  data () {
    return {
      useChangeInProgress: false,
      deviceConnectionsLoading: false,
      selectedConnection: null,
      moment: moment,
      model: {},
    };
  },
};
</script>


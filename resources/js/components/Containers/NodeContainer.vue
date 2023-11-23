<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="grid grid-cols-3 flex-grow bg-gray-100 overflow-auto">
    <!--Groups-->
    <ColumnList class="px-4" @selected="selectGroup" :selected-item="selectedGroup ? selectedGroup.id : null"
                property="groups"
                :loading="groupsLoading" :items="groups"
                name="Groups">
      <template #admin-actions>
        <button type="button"
                @mouseup="showNewGroupDialog"
                class="fpl-button-brand">
          <div class="mr-2">New Group</div>
          <i class="fa-sharp fa-solid fa-plus text-xs"></i>
        </button>
      </template>
      <template v-slot:item="{ item }">
        <div class="flex-1 px-4 py-2 text-sm truncate h-16 flex flex-col justify-center">
          <div class="flex items-center justify-between gap-2">
            <div class="flex-1 px-4 py-2 text-sm truncate h-16 flex flex-col justify-center">
              <a href="#" class="text-gray-500 font-semibold">{{item.name}}</a>
              <p class="text-gray-400">{{item.nodes_count}} Nodes</p>
            </div>
            <div class="flex items-center justify-center gap-0">
              <button type="button"
                      class="fpl-button-info w-6 !h-6 hover:!text-red-300"
                      @click.stop="maybeDeleteGroup(item.id)">
                <i class="fa-sharp fa-solid fa-trash text-xs"></i>
              </button>
            </div>
          </div>
          <div class="flex items-center text-gray-400 text-xs">
            <p v-tooltip="'Node UUID'" v-if="$root.$data.userPreferences.appearance.preferences.show_uuids.value">
              {{item.uuid}}</p>
          </div>
        </div>
      </template>
    </ColumnList>
    <new-group-overlay :show="newGroupDialogVisible"
                       @close="() => {newGroupDialogVisible = false;}"
                       @completed="newGroupCreated"></new-group-overlay>

    <!--Nodes-->
    <ColumnList class="px-4" @selected="selectNode" :selected-item="selectedNode ? selectedNode.id : null"
                v-if="selectedGroup"
                property="nodes" :loading="nodesLoading"
                :items="nodes"
                name="Nodes">
      <template #admin-actions>
        <button type="button"
                @mouseup="showNewNodeDialog"
                class="fpl-button-brand">
          <div class="mr-2">New Node</div>
          <i class="fa-sharp fa-solid fa-plus text-xs"></i>
        </button>
      </template>
      <template v-slot:item="{ item }">
        <div class="flex-1 px-4 py-2 text-sm truncate h-16 flex flex-col justify-center">
          <div class="flex items-center justify-between gap-2">
            <a href="#" class="text-gray-500 font-semibold hover:text-gray-700 mb-1">{{item.node_id}}</a>
            <div class="flex items-center justify-center gap-0">
              <button v-if="$root.$data.user.administrator" type="button"
                      @mouseup="showNodeUserDialog(item)"
                      v-tooltip="'Manage User Access'"
                      class="fpl-button-info w-6 !h-6">
                <i class="fa-sharp fa-solid fa-users text-xs"></i>
              </button>
              <button type="button"
                      class="fpl-button-info w-6 !h-6 hover:!text-red-300"
                      @click.stop="maybeDeleteNode(selectedGroup.id, item.id)">
                <i class="fa-sharp fa-solid fa-trash text-xs"></i>
              </button>
            </div>
          </div>
          <div class="flex items-center text-gray-400 text-xs">
            <p v-tooltip="'Node UUID'" v-if="$root.$data.userPreferences.appearance.preferences.show_uuids.value">
              {{item.uuid}}</p>
          </div>
        </div>
      </template>
    </ColumnList>
    <new-node-overlay v-if="selectedGroup" :show="newNodeDialogVisible" @close="newNodeDialogVisible=false"
                      :edge-clusters="edgeClusters"
                      :group="selectedGroup" @complete="newNodeCreated"></new-node-overlay>
    <node-user-overlay v-if="showNodeUserDialogFor" :show="!!showNodeUserDialogFor" :node="showNodeUserDialogFor" :group="selectedGroup"
                       @close="() => {showNodeUserDialogFor = null;}"></node-user-overlay>

    <!--Devices-->
    <ColumnList class="px-4" @selected="selectDevice" :selected-item="selectedDevice ? selectedDevice.id : null"
                v-if="selectedNode"
                property="devices"
                :loading="devicesLoading" :items="devices"
                name="Devices">
      <template #actions>
        <button type="button"
                class="fpl-button-brand"
                @click="createNewDevice">
          <div class="mr-2">New Device</div>
          <i class="fa-sharp fa-solid fa-plus text-xs"></i>
        </button>
      </template>
      <template v-slot:item="{ item }">
        <div class="flex-1 px-4 py-2 text-sm truncate h-16 flex flex-col justify-center">
          <div class="flex items-center justify-between gap-2">
            <div>
              <a href="#" class="text-gray-500 font-semibold hover:text-gray-700 mb-1">{{
                  item.device_id || 'New Device'
                }}</a>
              <div class="flex items-center text-gray-400 text-xs">
                <p v-tooltip="'Instance UUID'" v-if="$root.$data.userPreferences.appearance.preferences.show_uuids.value">
                  {{item.instance_uuid}}</p>
              </div>
            </div>
          </div>
        </div>
      </template>
    </ColumnList>

  </div>
</template>

<script>
export default {
  name: 'NodeContainer',

  components: {
    'ColumnList': () => import(/* webpackPrefetch: true */ '../General/ColumnList.vue'),
    'new-group-overlay': () => import(/* webpackPrefetch: true */ '../Groups/NewGroupOverlay.vue'),
    'new-node-overlay': () => import(/* webpackPrefetch: true */ '../Nodes/NewNodeOverlay.vue'),
    'node-user-overlay': () => import(/* webpackPrefetch: true */ '../Nodes/NodeUserOverlay.vue'),
  },

  props: {
    initialData: {},
  },

  watch: {
    selectedGroup () {
      this.selectedNode = null
      this.selectedDevice = null
    },

    selectedNode () {
      this.selectedDevice = null
    },

  },

  mounted () {
    this.initialiseContainerComponent()
  },

  methods: {
    showNewGroupDialog () {
      this.newGroupDialogVisible = true
    },

    showNewNodeDialog () {
      this.newNodeDialogVisible = true
    },

    showNodeUserDialog(item) {
      this.showNodeUserDialogFor = item;
    },

    newGroupCreated (response) {
      this.newGroupDialogVisible = false
      this.requestDataReloadFor('groups', {}, {}, () => {
        this.selectGroup(this.groups.find(e => e.id === response.data.data.id))
      })
    },

    newNodeCreated (response) {
      this.newNodeDialogVisible = false
      this.selectNode(response.data.data.node)
    },

    showNewDeviceDialog () {
      this.newDeviceDialogVisible = true
    },

    selectGroup (group) {
      this.selectedGroup = group
      this.nodesRouteVar = { group: this.selectedGroup.id }
      this.requestDataReloadFor('nodes')
    },

    selectNode (node) {
      this.selectedNode = node
      this.devicesRouteVar = { group: this.selectedGroup.id, node: this.selectedNode.id }
      this.requestDataReloadFor('devices')
    },

    selectDevice (device) {
      this.goto_url('/groups/' + this.selectedGroup.id + '/nodes/' + this.selectedNode.id + '/devices/' + device.id)
    },

    createNewDevice () {
      axios.post(`/api/groups/${this.selectedGroup.id}/nodes/${this.selectedNode.id}/devices`, {
        'node_id': this.selectedNode.id,
      }).then(e => {
        this.selectDevice(e.data.data)
      }).catch(error => {
        if (error && error.response && error.response.status === 401) {
          this.goto_url('/login')
        }
        this.handleError(error)
      })
    },

    maybeDeleteNode(group, node) {
      if (this.deletingNode) return;

      window.showNotification({
        title: 'Are you sure?',
        description: 'This will delete the node. This action is not reversible.',
        type: 'error',
        persistent: true,
        buttons: [
          {
            text: 'Delete Node', type: 'error', loadingOnClick: true, action: () => {
              this.deleteNode(group, node)
            },
          },
          {text: 'Cancel', isClose: true}
        ],
        id: 'eddd8225-2356-498b-9342-811a63c064e1',
      });
    },

    deleteNode (group, node) {
      this.deletingNode = true;
      axios.delete(`/api/groups/${group}/nodes/${node}`).then(() => {
        window.showNotification({
            title: 'Node Deleted',
            description: 'The node has been deleted.',
            type: 'success',
            id: 'eddd8225-2356-498b-9342-811a63c064e1',
        });
        this.requestDataReloadFor('nodes')
        this.deletingNode = false;
      }).catch(error => {
        if (error && error.response && error.response.status === 401) {
          this.goto_url('/login')
        }
        this.handleError(error, 'eddd8225-2356-498b-9342-811a63c064e1')
        this.deletingNode = false;
      })
    },


    maybeDeleteGroup(group) {
      if (this.deletingGroup) return;

      window.showNotification({
        title: 'Are you sure?',
        description: 'This will delete the group. This action is not reversible.',
        type: 'error',
        persistent: true,
        buttons: [
          {
            text: 'Delete Group', type: 'error', loadingOnClick: true, action: () => {
              this.deleteGroup(group)
            },
          },
          {text: 'Cancel', isClose: true}
        ],
        id: '12e62a89-6d3e-4970-8357-fbb2dbbbfafc',
      });
    },

    deleteGroup (group) {
      this.deletingGroup = true;
      axios.delete(`/api/groups/${group}`).then(() => {
        window.showNotification({
          title: 'Group Deleted',
          description: 'The group has been deleted.',
          type: 'success',
          id: '12e62a89-6d3e-4970-8357-fbb2dbbbfafc',
        });
        this.requestDataReloadFor('groups')
        this.deletingGroup = false;
      }).catch(error => {
        if (error && error.response && error.response.status === 401) {
          this.goto_url('/login')
        }
        this.handleError(error, '12e62a89-6d3e-4970-8357-fbb2dbbbfafc')
        this.deletingGroup = false;
      })
    },

  },

  data () {
    return {
      isContainer: true,
      newGroupDialogVisible: false,
      newNodeDialogVisible: false,
      newDeviceDialogVisible: false,
      showNodeUserDialogFor: null,

      // groups
      groups: null,
      groupsLoading: false,
      groupsLoaded: false,
      groupsQueryBank: null,
      groupsRouteVar: null,
      groupsForceLoad: true,
      selectedGroup: null,
      deletingGroup: false,

      // nodes
      nodes: null,
      nodesLoading: false,
      nodesLoaded: false,
      nodesQueryBank: null,
      nodesRouteVar: null,
      selectedNode: null,
      deletingNode: false,

      // devices
      devices: null,
      devicesLoading: null,
      devicesLoaded: null,
      devicesQueryBank: null,
      devicesRouteVar: null,
      selectedDevice: null,

      // roles
      roles: null,
      rolesLoading: null,
      rolesLoaded: null,
      rolesQueryBank: null,
      rolesRouteVar: null,

      // clusters
      clusters: null,
      clustersLoading: false,
      clustersLoaded: false,
      clustersQueryBank: {},
      clustersRouteVar: null,
      clustersForceLoad: true,

      // edgeClusters
      edgeClusters: null,
      edgeClustersLoading: false,
      edgeClustersLoaded: false,
      edgeClustersQueryBank: {},
      edgeClustersRouteVar: null,

    }
  },
}
</script>

<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="grid grid-cols-3 flex-grow bg-gray-100 overflow-auto">
    <ColumnList class="px-4"
                property="edgeClusters" :loading="edgeClustersLoading"
                :items="edgeClusters"
                name="Edge Clusters">
      <template #admin-actions>
        <button type="button"
                @mouseup="showNewClusterDialog"
                class="fpl-button-brand">
          <div class="mr-2">New Cluster</div>
          <i class="fa-sharp fa-solid fa-plus text-xs"></i>
        </button>
      </template>
      <template v-slot:item="{ item, index }">
        <div class="flex-1 px-4 py-2 text-sm truncate h-16 flex flex-col justify-center">
          <div class="flex items-center justify-between gap-2">
            <a href="#" class="text-gray-500 font-semibold hover:text-gray-700 mb-1">{{index}}</a>
            <div class="flex items-center justify-center gap-0">
            </div>
          </div>
          <div v-if="item.status" class="flex items-center text-gray-400 text-xs">{{item.status?.nodes.length}} Nodes
          </div>
          <div v-else class="flex items-center text-gray-400 animate-pulse text-xs tracking-wider font-normal gap-1">
            <div class="flex items-center justify-center">
              <i class="fa-solid fa-circle-notch fa-spin"></i>
            </div>
            <div>Awaiting bootstrap...</div>
          </div>
        </div>
        <button type="button"
                @mouseup="() => {copyBootstrapCommand(item)}"
                class="fpl-button-secondary mr-3"
                v-tooltip="'Copy bootstrap command to clipboard'"
        >
          <i class="fa-sharp fa-solid fa-file-code"></i>
        </button>
      </template>
    </ColumnList>
    <new-edge-cluster-overlay :show="newClusterDialogVisible" @close="newClusterDialogVisible=false"
                              @complete="newClusterCreated" :helm-chart-templates="helmChartTemplates"
                              :default-helm-chart-templates="defaultHelmChartTemplates"></new-edge-cluster-overlay>
  </div>
</template>

<script>
export default {
  name: 'EdgeClusterContainer',

  components: {
    'ColumnList': () => import(/* webpackPrefetch: true */ '../General/ColumnList.vue'),
    'new-edge-cluster-overlay': () => import(/* webpackPrefetch: true */ '../EdgeClusters/NewEdgeClusterOverlay.vue'),
  },

  props: {
    initialData: {},
  },

  mounted () {
    this.initialiseContainerComponent()
  },

  methods: {
    showNewClusterDialog () {
      this.newClusterDialogVisible = true
    },

    copyBootstrapCommand (item) {
      axios.get(`/api/edge-clusters/${item.name}/bootstrap-command`).then((response) => {
        if (response.data.data) {
          this.copyToClipboard(response.data.data)
          window.showNotification({
            title: 'Copied to clipboard',
            description: 'The bootstrap command has been copied to your clipboard. Paste this onto the node you wish to bootstrap.',
            type: 'success',
          })
        } else {
          window.showNotification({
            title: 'Not ready',
            description: 'The bootstrap script is not ready yet. Please wait a few moments and try again.',
            type: 'error',
          })
        }
      })
    },

    async copyToClipboard (text) {
      try {
        await navigator.clipboard.writeText(text)
      } catch (err) {
        window.showNotification({
          title: 'Failed to copy to clipboard.',
          description: err,
          type: 'error',
        })
      }
    },

    newClusterCreated (response) {
      this.newClusterDialogVisible = false
    },
  },

  data () {
    return {
      isContainer: true,
      newClusterDialogVisible: false,

      // edgeClusters
      edgeClusters: null,
      edgeClustersLoading: false,
      edgeClustersLoaded: false,
      edgeClustersQueryBank: {},
      edgeClustersRouteVar: null,
      edgeClustersForceLoad: true,

      // helmChartTemplates
      helmChartTemplates: null,
      helmChartTemplatesLoading: false,
      helmChartTemplatesLoaded: false,
      helmChartTemplatesQueryBank: {},
      helmChartTemplatesRouteVar: null,
      helmChartTemplatesForceLoad: true,

      // defaultHelmChartTemplates
      defaultHelmChartTemplates: null,
      defaultHelmChartTemplatesLoading: false,
      defaultHelmChartTemplatesLoaded: false,
      defaultHelmChartTemplatesQueryBank: {},
      defaultHelmChartTemplatesRouteVar: null,
      defaultHelmChartTemplatesForceLoad: true,

    }
  },
}
</script>

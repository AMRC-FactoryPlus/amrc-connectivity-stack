<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <EdgeContainer>
      <div v-if="loadingDetails">LOADING</div>
      <div v-else>
        <div>Edge Cluster: {{cluster}}</div>
        <div>Nodes: {{nodes}}</div>
      </div>
  </EdgeContainer>
</template>

<script>
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { UUIDs } from '@amrc-factoryplus/service-client'
import { useNodeStore } from '@store/useNodeStore.js'
import EdgeContainer from '@components/Containers/EdgeContainer.vue'

export default {
  components: { EdgeContainer },

  setup () {
    return {
      s: useNodeStore(),
    }
  },

  watch: {
    async '$route.params.uuid' (newUuid) {

      await this.getClusterDetails(newUuid)

    },

    test: {
      handler (newVal, oldVal) {
        console.log('test', newVal)
      },
      deep: true,
      immediate: true,
    }
  },

  mounted () {
    this.getClusterDetails(this.$route.params.uuid)
  },

  methods: {
    async getClusterDetails (uuid) {
      this.loadingDetails = true

      // Get the cluster details here and merge them with the cluster
      // object. We need:
      // - Name & Deployed Helm Chart (we get this from bdb13634-0b3d-4e38-a065-9d88c12ee78d Edge cluster configuration)
      // - The hosts that are assigned to this cluster and their details (we get this from 747a62c9-1b66-4a2e-8dd9-0b70a91b6b75 Edge cluster status)
      // - The Nodes in this cluster, their name, status and\ other information (we get this from useNodeStore)

      this.cluster.uuid = uuid;

      const edgeClusterConfigResponse = await useServiceClientStore().client.ConfigDB.fetch(`/v1/app/${UUIDs.App.EdgeClusterConfiguration}/object/${this.cluster.uuid}`)

      const edgeClusterConfig = edgeClusterConfigResponse[1]
      this.cluster.name       = edgeClusterConfig.name
      this.cluster.namespace  = edgeClusterConfig.namespace

      // Get the name of the deployed helm chart from its UUID using the
      // Helm Chart Template App
      const helmChartTemplateAppResponse = await useServiceClientStore().
        client.
        ConfigDB.
        fetch(`/v1/app/${UUIDs.App.HelmChartTemplate}/object/${edgeClusterConfig.chart}`)

      const helmChartTemplate = helmChartTemplateAppResponse[1]

      this.cluster.helmChart = {
        chart: helmChartTemplate.chart,
        source: helmChartTemplate.source,
      }

      // Get the hosts assigned to this cluster and their details using
      // the Edge cluster status app
      const edgeClusterStatusResponse = await useServiceClientStore().
        client.
        ConfigDB.
        fetch(`/v1/app/${UUIDs.App.EdgeClusterStatus}/object/${this.cluster.uuid}`)

      const edgeClusterStatus = edgeClusterStatusResponse[1]

      this.cluster.hosts = edgeClusterStatus.hosts

      await this.s.fetch()

      // this.cluster.nodes = this.s.data.filter(e => e.cluster === this.cluster.uuid) ?? []

      this.loadingDetails = false
    },
  },

  computed: {
    nodes () {
      return Array.isArray(this.s.data) ? this.s.data.filter(e => e.cluster === this.cluster.uuid) : []
    },
  },

  data () {
    return {
      loadingDetails: true,
      cluster: {},
      test: [],
    }
  },
}
</script>
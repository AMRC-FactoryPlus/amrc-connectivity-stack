<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The Edge Clusters & Devices tree. It shows only to users who can
     read the edge clusters, because the tree is built from them; it
     stays hidden while their permissions load. -->
<template>
  <SidebarGroup v-if="shown">
    <SidebarGroupLabel class="mb-2">Edge Clusters & Devices</SidebarGroupLabel>
    <SidebarGroupContent>
      <SidebarMenu>
        <EdgeClusterList/>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>

<script>
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu } from '@/components/ui/sidebar'
import EdgeClusterList from '@/components/Nav/EdgeClusterList.vue'
import { useAccessStore } from '@store/useAccessStore.js'
import { can_read_clusters } from '@/lib/access/sections.js'

export default {
  name: 'EdgeNav',

  components: {
    EdgeClusterList,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
  },

  setup () {
    return { access: useAccessStore() }
  },

  computed: {
    /* False while the ACL loads, as every check is. */
    shown () {
      return can_read_clusters(this.access.check)
    },
  },
}
</script>

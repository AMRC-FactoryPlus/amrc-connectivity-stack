<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <!-- Labelled, the button says what it does; a tooltip would only
     - repeat it. Icon-only in a table row, it needs one. -->
  <Button
      v-if="allowed && labelled"
      size="xs"
      variant="outline"
      class="flex items-center justify-center gap-1.5 hover:bg-gray-800 hover:text-white"
      title="Move this node to another host"
      @click.stop="move"
  >
    <i class="fa-solid fa-right-left text-xs"></i>
    Move
  </Button>
  <TooltipProvider v-else-if="allowed">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          size="xs"
          variant="outline"
          class="w-8 px-0 flex items-center justify-center hover:bg-gray-800 hover:text-white"
          @click.stop="move"
        >
          <i class="fa-solid fa-right-left text-xs"></i>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Move to another host</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<script>
import { Button } from '@components/ui/button/index.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAccessStore } from '@store/useAccessStore.js'
import { can_move_host } from '@/lib/access/perms-edge.js'
import { useConnectionStore } from '@store/useConnectionStore.js'

export default {
  name: 'MoveHostButton',

  components: { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger },

  props: {
    uuid: { type: String, required: true },
    name: { type: String, required: true },
    /* "node" for edge agents, anything else for plain deployments. Nodes
     * have connections which carry a copy of the hostname. */
    kind: { type: String, default: 'deployment' },
    deployment: { type: Object, required: true },
    /* Sidebars have room for the word; table rows do not. */
    labelled: { type: Boolean, default: false },
  },

  setup () {
    return { access: useAccessStore(), cn: useConnectionStore() }
  },

  computed: {
    /* A move patches the deployment, and for a node its connections. */
    allowed () {
      const conns = Array.isArray(this.cn.data) ? this.cn.data : []
      const has_connections = conns.some(e => e.configuration?.edgeAgent === this.uuid)
      return can_move_host(this.access.check, this.kind, has_connections)
    },
  },

  methods: {
    move () {
      window.events.emit('show-move-host-dialog', {
        uuid: this.uuid,
        name: this.name,
        kind: this.kind,
        deployment: this.deployment,
      })
    },
  },
}
</script>

<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <!-- Labelled, the button says what it does; a tooltip would only
     - repeat it. Icon-only in a table row, it needs one. -->
  <Button
      v-if="labelled"
      size="xs"
      variant="outline"
      class="flex items-center justify-center gap-1.5 hover:bg-gray-800 hover:text-white"
      title="Move this node to another host"
      @click.stop="move"
  >
    <i class="fa-solid fa-right-left text-xs"></i>
    Move
  </Button>
  <TooltipProvider v-else>
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

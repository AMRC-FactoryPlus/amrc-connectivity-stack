<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          size="xs"
          variant="outline"
          class="flex items-center justify-center gap-1.5 hover:bg-gray-800 hover:text-white"
          @click.stop="move"
        >
          <i class="fa-solid fa-right-left"></i>
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

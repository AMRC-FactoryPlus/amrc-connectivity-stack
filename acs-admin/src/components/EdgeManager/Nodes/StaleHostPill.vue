<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <TooltipProvider v-if="tooltip">
    <Tooltip>
      <TooltipTrigger as-child>
        <span :class="pillClass">
          <i class="fa-solid fa-triangle-exclamation text-[9px]"></i>Not in cluster
        </span>
      </TooltipTrigger>
      <TooltipContent class="max-w-72">
        <p>{{ STALE_HOST_WARNING }}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <span v-else :class="pillClass">
    <i class="fa-solid fa-triangle-exclamation text-[9px]"></i>Not in cluster
  </span>
</template>

<script>
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { STALE_HOST_WARNING } from '@utils/hosts.js'

export default {
  name: 'StaleHostPill',

  components: { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger },

  props: {
    /* Table cells have no room for the explanation, so they carry it as
     * a tooltip. The sidebar prints it underneath instead. */
    tooltip: {
      type: Boolean,
      default: false,
    },
  },

  data () {
    return {
      STALE_HOST_WARNING,
      pillClass: 'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full '
        + 'bg-amber-50 ring-1 ring-amber-200 text-amber-700 text-[11px] '
        + 'font-semibold whitespace-nowrap',
    }
  },
}
</script>

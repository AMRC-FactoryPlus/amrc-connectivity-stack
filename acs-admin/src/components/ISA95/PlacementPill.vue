<!--
  - ACS Admin
  - A warning pill for a device that is not on the UNS.
  - Copyright 2026 University of Sheffield AMRC
  -->

<template>
  <template v-if="label">
    <TooltipProvider v-if="tooltip">
      <Tooltip>
        <TooltipTrigger as-child>
          <span :class="pillClass">
            <i class="fa-solid fa-triangle-exclamation text-[9px]"></i>{{ label }}
          </span>
        </TooltipTrigger>
        <TooltipContent class="max-w-72">
          <p>{{ explanation }}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <span v-else :class="pillClass">
      <i class="fa-solid fa-triangle-exclamation text-[9px]"></i>{{ label }}
    </span>
  </template>
</template>

<script>
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { placement_explanation } from '@/lib/isa95-placement.js'

const BASE = 'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full '
    + 'ring-1 text-[11px] font-semibold whitespace-nowrap '

export default {
    name: 'PlacementPill',

    components: { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger },

    props: {
        /* From placement_state: 'placed', 'unplaced' or 'broken'. A
         * placed device gets no pill. */
        state: {
            type: String,
            default: null,
        },
        error: {
            type: String,
            default: null,
        },
        /* Table cells have no room for the explanation, so they carry
         * it as a tooltip. */
        tooltip: {
            type: Boolean,
            default: false,
        },
    },

    computed: {
        label () {
            if (this.state === 'unplaced') return 'Not placed'
            if (this.state === 'broken') return 'Broken placement'
            return null
        },

        explanation () {
            return placement_explanation(this.state, this.error)
        },

        pillClass () {
            return BASE + (this.state === 'broken'
                ? 'bg-red-50 ring-red-200 text-red-700'
                : 'bg-amber-50 ring-amber-200 text-amber-700')
        },
    },
}
</script>

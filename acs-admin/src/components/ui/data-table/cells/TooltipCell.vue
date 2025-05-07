<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>{{content}}</TooltipTrigger>
          <TooltipContent>
            <p>{{tooltip}}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </Tooltip>
  </TooltipProvider>
</template>

<script>
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export default {
  props: {
    content: {
      type: String,
      required: true,
    },
    tooltip: {
      type: String,
      required: true,
    },
  },
  components: {
    Badge,
    Tooltip,
    TooltipProvider,
    TooltipTrigger,
    TooltipContent,
  },
}
</script>

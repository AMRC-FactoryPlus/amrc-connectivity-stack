<template>
  <TooltipProvider v-if="canRebirth">
    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          size="xs"
          variant="outline"
          :disabled="loading"
          class="ml-auto flex items-center justify-center gap-1.5 hover:bg-gray-800 hover:text-white"
          @click.stop="rebirth"
        >
          <i class="fa-solid" :class="loading ? 'fa-circle-notch animate-spin' : 'fa-tower-broadcast'"></i>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Rebirth</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<script>
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { Button } from '@components/ui/button/index.js'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'vue-sonner'

export default {
  components: { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger },
  props: {
    address: { type: String, required: true },
    name: { type: String, required: true },
    isDevice: { type: Boolean, default: false },
    canRebirth: { type: Boolean, default: false },
  },
  data () {
    return { loading: false }
  },
  methods: {
    async rebirth () {
      this.loading = true
      const ctrl = this.isDevice ? 'Device Control' : 'Node Control'
      try {
        await useServiceClientStore().client.CmdEsc.request_cmd({
          address: this.address,
          name: `${ctrl}/Rebirth`,
          type: 'Boolean',
          value: true,
        })
        toast.success(`Rebirth sent to ${this.name}`)
      } catch (e) {
        if (e.status === 403) {
          toast.error(`Permission denied: cannot rebirth ${this.name}`)
        } else {
          toast.error(`Failed to rebirth ${this.name}`)
        }
        console.error(e)
      } finally {
        this.loading = false
      }
    }
  }
}
</script>

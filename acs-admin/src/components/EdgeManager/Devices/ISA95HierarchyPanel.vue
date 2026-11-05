<!--
  - ACS Admin
  - ISA-95 placement panel for the device sidebar.
  - Copyright 2026 University of Sheffield AMRC
  -->

<template>
  <div class="flex items-center justify-between gap-2 p-4 border-b">
    <div class="font-semibold text-lg">ISA-95 Placement</div>
    <Button v-if="device.placement?.node"
        title="Clear placement"
        size="sm"
        variant="ghost"
        :disabled="busy"
        class="flex items-center justify-center gap-2"
        @click="confirm_clear"
    >
      <i class="fa-solid fa-trash text-sm text-red-400"></i>
    </Button>
  </div>
  <div class="space-y-4 p-4">
    <div v-if="!isa95.ready" class="text-sm text-gray-500">
      Loading the ISA-95 vocabulary...
    </div>
    <div v-else-if="isa95.enterprises.length === 0" class="text-sm text-gray-500">
      There is no ISA-95 vocabulary yet. Create one on the
      <RouterLink to="/isa95" class="underline hover:text-gray-900">ISA-95 page</RouterLink>,
      then place this device.
    </div>
    <template v-else>
      <div v-if="status.state === 'placed'" class="flex items-start gap-2 text-sm">
        <i class="fa-solid fa-circle-check text-green-500 mt-1"></i>
        <div class="min-w-0">
          <div class="font-medium">On the UNS</div>
          <div class="text-gray-500 break-words">{{ status.path.join(' / ') }}</div>
        </div>
      </div>
      <div v-else class="flex flex-col items-start gap-1.5">
        <PlacementPill :state="status.state" :error="status.error"/>
        <p class="text-xs text-gray-500">{{ explanation }}</p>
      </div>
      <ISA95PlacementPicker
          :model-value="shown"
          :disabled="busy"
          @update:model-value="place"
      />
    </template>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'
import { UUIDs } from '@amrc-factoryplus/service-client'

import { Button } from '@/components/ui/button'
import { useISA95Store } from '@/store/useISA95Store.js'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { useDialog } from '@/composables/useDialog'
import {
    placement_chain, placement_explanation, placement_state,
} from '@/lib/isa95-placement.js'
import ISA95PlacementPicker from '@/components/ISA95/ISA95PlacementPicker.vue'
import PlacementPill from '@/components/ISA95/PlacementPill.vue'

export default {
    name: 'ISA95HierarchyPanel',

    components: {
        Button,
        ISA95PlacementPicker,
        PlacementPill,
    },

    setup () {
        return {
            isa95: useISA95Store(),
            s: useServiceClientStore(),
        }
    },

    props: {
        device: {
            required: true,
            type: Object,
        },
    },

    data () {
        return {
            busy: false,
            /* The chain last written, shown until the store catches up. */
            pending: null,
        }
    },

    mounted () {
        this.isa95.start()
    },

    computed: {
        status () {
            return placement_state(this.isa95.vocabulary, this.device.placement, this.device.uuid)
        },

        explanation () {
            return placement_explanation(this.status.state, this.status.error)
        },

        /* The stored placement, as the chain of node UUIDs. Empty for an
         * unplaced device or a broken placement. */
        stored () {
            return placement_chain(this.isa95.vocabulary, this.device.placement)
                .map(n => n.uuid)
        },

        shown () {
            return this.pending ?? this.stored
        },

        stored_node () {
            return this.device.placement?.node ?? null
        },
    },

    watch: {
        stored_node () {
            this.pending = null
        },

        'device.uuid' () {
            this.pending = null
        },
    },

    methods: {
        /* Choosing a level places the device on that node. Levels below
         * it are cleared, because the placement is the deepest node. */
        async place (chain) {
            const node = chain.at(-1)
            if (!node) return
            if (node === this.stored_node) {
                this.pending = null
                return
            }

            this.busy = true
            this.pending = chain
            try {
                await this.s.client.ConfigDB.put_config(
                    UUIDs.App.ISA95Placement, this.device.uuid,
                    { ...(this.device.placement ?? {}), node })
            }
            catch (err) {
                console.error('Failed to place device:', err)
                this.pending = null
                toast.error('Unable to change the placement', {
                    description: err.message || 'An unexpected error occurred',
                })
            }
            finally {
                this.busy = false
            }
        },

        confirm_clear () {
            useDialog({
                title: 'Clear placement',
                message: `Remove the ISA-95 placement from ${this.device.name}? The device leaves the UNS until you place it again.`,
                confirmText: 'Clear',
                onConfirm: () => this.clear(),
            })
        },

        async clear () {
            this.busy = true
            try {
                await this.s.client.ConfigDB.delete_config(
                    UUIDs.App.ISA95Placement, this.device.uuid)
                this.pending = null
                toast.success(`Cleared the placement of ${this.device.name}`)
            }
            catch (err) {
                console.error('Failed to clear placement:', err)
                toast.error('Unable to clear the placement', {
                    description: err.message || 'An unexpected error occurred',
                })
            }
            finally {
                this.busy = false
            }
        },
    },
}
</script>

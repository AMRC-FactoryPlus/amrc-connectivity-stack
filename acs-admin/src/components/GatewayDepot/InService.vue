<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Step 5: a gateway that is onboarded. An onboarded gateway that is
     not in contact is a real fault, so it says so first. -->
<template>
  <div class="flex flex-col gap-4">
    <p class="text-sm text-slate-500">In service</p>

    <Alert v-if="!gateway.online" variant="destructive">
      <AlertTitle class="font-semibold">This gateway is not in contact.</AlertTitle>
      <AlertDescription class="flex flex-col gap-1">
        <p>Check that the gateway is powered on and that its northbound cable is plugged in{{ gateway.last_seen ? '. It was last seen ' + ago(gateway.last_seen, now.getTime()) : '' }}.</p>
        <p v-if="replaceable">If the hardware has failed, boot a blank PC from the depot USB stick and choose this gateway as the one it replaces when you approve it.</p>
      </AlertDescription>
    </Alert>

    <div v-if="gateway.replaces" class="flex flex-col gap-2 rounded-lg bg-slate-100 p-4 text-sm">
      <h3 class="font-semibold">Enter the connection secrets again</h3>
      <p>{{ redo }}</p>
    </div>

    <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      <template v-if="cluster">
        <dt class="text-slate-500">Cluster</dt>
        <dd class="break-words">{{ cluster }}</dd>
      </template>
      <dt class="text-slate-500">Factory+</dt>
      <dd class="font-medium" :class="reported ? 'text-green-700' : 'text-amber-700'">
        {{ reported ? 'Listed as a host of its cluster' : 'Waiting to be listed as a host of its cluster' }}
      </dd>
      <template v-if="k3s">
        <dt class="text-slate-500">k3s version</dt>
        <dd class="break-words">{{ k3s }}</dd>
      </template>
    </dl>

    <div>
      <h3 class="mb-2 text-sm font-semibold">Ports</h3>
      <PortTiles :gateway-id="gateway.id" :nics="ports.nics" :role="ports.role" copy/>
    </div>

    <details v-if="gateway.log">
      <summary class="cursor-pointer py-1 text-sm font-medium">Log from onboarding</summary>
      <GatewayLog class="mt-2" :text="gateway.log"/>
    </details>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useNow } from '@vueuse/core'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useGatewayDepotStore } from '@store/useGatewayDepotStore.js'
import { ago, can_be_replaced, clean, configured_ports, label_for, service_cluster_text } from '@/lib/gateway-depot/model.js'
import GatewayLog from './GatewayLog.vue'
import PortTiles from './PortTiles.vue'

const props = defineProps({
  gateway: { type: Object, required: true },
})

const depot = useGatewayDepotStore()
const now = useNow({ interval: 10000 })

const cluster = computed(() => service_cluster_text(props.gateway, depot.byId))
const reported = computed(() => !!(props.gateway.onboard && props.gateway.onboard.reported))
const k3s = computed(() => clean(props.gateway.report && props.gateway.report.k3s))
const ports = computed(() => configured_ports(props.gateway))
const replaceable = computed(() => can_be_replaced(props.gateway, null))
const redo = computed(() => {
  const from = depot.byId.get(props.gateway.replaces)
  return 'This gateway replaced ' + (from ? label_for(from) : 'another gateway')
    + ', so connection secrets entered for the old gateway, such as a driver’s password, must be entered again in the Factory+ admin tool.'
    + (clean(props.gateway.settings && props.gateway.settings.hostname) ? '' : ' The gateway also has a new hostname, so you must move each deployment to it by hand in another tool.')
})
</script>

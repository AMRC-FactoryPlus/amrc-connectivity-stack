<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- The Gateway Depot: every gateway, grouped by what needs a person.
     Choosing one opens its page. -->
<template>
  <GatewayDepotContainer>
    <DepotLoad>
      <EmptyState v-if="!depot.gateways.length"
          icon="server"
          title="No gateways yet"
          description="To begin, boot a blank PC from the depot USB stick with a network cable plugged in, and the gateway appears on this page within about a minute.">
        <template #actions><StickDownload/></template>
      </EmptyState>
      <template v-else>
        <section v-for="(g, i) in groups" :key="g.key" :aria-label="g.label">
          <DataTable :data="g.rows" :columns="columns" :filters="[]" @row-click="row => open(row.original.id)">
            <template #toolbar-left>
              <h2 class="flex items-center gap-2 text-sm font-semibold">
                <span class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{{ g.count }}</span>
                {{ g.label }}
                <template v-if="g.quiet">
                  <span class="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{{ g.quiet }}</span>
                  Not in contact
                </template>
              </h2>
            </template>
            <template v-if="i === 0" #toolbar-right><StickMenu/></template>
          </DataTable>
        </section>
      </template>
    </DepotLoad>
  </GatewayDepotContainer>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMediaQuery, useNow } from '@vueuse/core'
import EmptyState from '@components/EmptyState.vue'
import DataTable from '@components/ui/data-table/DataTable.vue'
import GatewayDepotContainer from '@components/Containers/GatewayDepotContainer.vue'
import DepotLoad from '@components/GatewayDepot/DepotLoad.vue'
import StickDownload from '@components/GatewayDepot/StickDownload.vue'
import StickMenu from '@components/GatewayDepot/StickMenu.vue'
import { useGatewayDepotStore } from '@store/useGatewayDepotStore.js'
import { row_of } from '@/lib/gateway-depot/model.js'
import { gatewayColumns, gatewayColumnsNarrow } from './gatewayColumns.ts'

const depot = useGatewayDepotStore()
const router = useRouter()
const now = useNow({ interval: 10000 })
const wide = useMediaQuery('(min-width: 1024px)')

const columns = computed(() => (wide.value ? gatewayColumns : gatewayColumnsNarrow))

const groups = computed(() => depot.groups.map(g => ({
  ...g,
  rows: g.gateways.map(gw => ({ ...row_of(gw, now.value.getTime()), password: !!depot.secrets[gw.id] && !depot.secrets[gw.id].ack })),
})))

const open = id => router.push({ name: 'GatewayDepotGateway', params: { id } })

onMounted(() => depot.start())
onUnmounted(() => depot.stop())
</script>

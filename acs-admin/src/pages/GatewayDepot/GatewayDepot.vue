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
          description="To begin, boot a blank PC from the depot USB stick with a network cable plugged in, and the gateway appears on this page within about a minute."/>
      <template v-else>
        <section v-for="g in groups" :key="g.key" :aria-label="g.label">
          <DataTable :data="g.rows" :columns="columns" :filters="[]" @row-click="row => open(row.original.id)">
            <template #toolbar-left>
              <h2 class="text-sm font-semibold">{{ g.label }} · {{ g.count }}</h2>
            </template>
          </DataTable>
        </section>
      </template>
    </DepotLoad>

    <template v-slot:sidebar>
      <div v-if="depot.loaded && !depot.forbidden" class="shrink-0 border-t border-border lg:w-96 lg:overflow-y-auto lg:border-l lg:border-t-0">
        <div class="flex w-full items-center gap-2 border-b p-4">
          <i class="fa-fw fa-solid fa-list-ol"></i>
          <div class="text-xl font-semibold">{{ depot.gateways.length ? 'Choose a gateway from the list' : 'What happens after that' }}</div>
        </div>
        <div class="flex flex-col gap-4 p-4">
          <p v-if="depot.gateways.length" class="text-sm text-slate-500">Each gateway goes through five steps, and the list shows which gateways need you now.</p>
          <HowItWorks/>
          <p v-if="depot.gateways.length" class="text-sm text-slate-500">To add a gateway, boot a blank PC from the depot USB stick with a network cable plugged in, and the gateway appears in the list within about a minute.</p>
        </div>
      </div>
    </template>
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
import HowItWorks from '@components/GatewayDepot/HowItWorks.vue'
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
  rows: g.gateways.map(gw => ({ ...row_of(gw, now.value.getTime()), password: !!depot.secrets[gw.id] })),
})))

const open = id => router.push({ name: 'GatewayDepotGateway', params: { id } })

onMounted(() => depot.start())
onUnmounted(() => depot.stop())
</script>

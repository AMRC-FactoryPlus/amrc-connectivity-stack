<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- One gateway: what it is, whether it is in contact, and its five
     steps, with whatever the current step needs from a person. The
     gateway comes from the polled list, so everything a person types
     lives in the store or in the step's own component and a refresh
     only changes what the gateway reports. -->
<template>
  <GatewayDepotContainer>
    <DepotLoad>
      <RouterLink to="/gateway-depot" class="inline-flex min-h-9 items-center gap-2 self-start text-sm font-medium hover:underline">
        <i class="fa-solid fa-arrow-left"></i>All gateways
      </RouterLink>

      <div v-if="!gateway" class="flex flex-col gap-4">
        <h1 class="text-xl font-semibold">This gateway is no longer in the list</h1>
        <p class="text-sm text-slate-500">The gateway was removed or rejected, or it lost contact while waiting for approval. Once it boots from the depot USB stick again it appears as a new gateway.</p>
        <AdminLogin :id="id" named/>
      </div>

      <div v-else :key="id" class="flex flex-col gap-6">
        <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div class="flex min-w-0 flex-1 basis-80 flex-col gap-1">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 class="break-words text-xl font-semibold">{{ name_of(gateway) }}</h1>
              <StatePill :label="meta.label" :tone="meta.tone"/>
            </div>
            <p class="break-words text-sm text-slate-500">{{ subline_of(gateway) }}</p>
            <p v-if="relation" class="break-words text-sm text-slate-500">
              {{ relation.pre }}<RouterLink v-if="related" :to="{ name: 'GatewayDepotGateway', params: { id: related.id } }"
                  class="font-medium underline">{{ label_for(related) }}</RouterLink><template v-else>a gateway that is no longer in the list</template>{{ relation.post }}.
            </p>
            <p class="flex items-center gap-2 text-sm" :class="contact.warn ? 'font-medium text-amber-700' : ''">
              <i v-if="contact.warn" class="fa-solid fa-triangle-exclamation"></i>
              <span v-else class="size-2.5 shrink-0 rounded-full" :class="contact.tone === 'ok' ? 'bg-green-500' : 'border-2 border-slate-400'"></span>
              <span class="break-words">{{ contact.text }}</span>
            </p>
          </div>
          <Button v-if="kind !== 'installing' && kind !== 'onboarding'" variant="destructiveOutline" size="sm" :disabled="removing" @click="remove">
            {{ kind === 'pending' ? 'Reject' : 'Remove from list' }}
          </Button>
        </div>

        <!-- While it installs, the login sits in the Install step, where
             the person is looking after they approve. -->
        <AdminLogin v-if="kind !== 'installing'" :id="id"/>

        <div v-if="kind === 'replaced'" class="flex flex-col gap-4">
          <div class="flex flex-col gap-2 rounded-lg bg-slate-100 p-4 text-sm">
            <div class="flex flex-wrap items-baseline justify-between gap-x-4">
              <h3 class="font-semibold">Replaced</h3>
              <time v-if="gateway.replaced_at" class="text-xs text-slate-500" :datetime="new Date(gateway.replaced_at).toISOString()"
                  :title="new Date(gateway.replaced_at).toLocaleString()">{{ clock(gateway.replaced_at) }}</time>
            </div>
            <p>Another gateway took this one’s place.</p>
          </div>
          <dl v-if="cluster_name(gateway)" class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
            <dt class="text-slate-500">Cluster it served</dt>
            <dd class="break-words">{{ cluster_name(gateway) }}</dd>
          </dl>
        </div>

        <Alert v-else-if="kind === 'other'">
          <AlertDescription>This page does not know the state "{{ gateway.state }}".</AlertDescription>
        </Alert>

        <ol v-else class="list-none">
          <StepItem v-for="step in steps" :key="step.n" :step="step" :last="step.n === 5">
            <!-- Steps that are finished. -->
            <template v-if="step.status === 'done'">
              <template v-if="step.n === 1">
                <p class="text-sm text-slate-500">
                  {{ gateway.approved_by ? 'Approved by ' + gateway.approved_by + (gateway.approved_at ? ', ' + clock(gateway.approved_at) : '') + '.' : 'Approved.' }}
                </p>
                <details>
                  <summary class="cursor-pointer py-1 text-sm font-medium">Settings chosen at approval</summary>
                  <dl class="mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                    <template v-for="[label, value] in settings_rows(gateway)" :key="label">
                      <dt class="text-slate-500">{{ label }}</dt>
                      <dd class="break-words">{{ value }}</dd>
                    </template>
                  </dl>
                </details>
              </template>
              <p v-else-if="step.n === 2" class="text-sm text-slate-500">The operating system is installed.</p>
              <p v-else-if="step.n === 3" class="text-sm text-slate-500">The gateway is at the edge and in contact.</p>
              <p v-else-if="step.n === 4" class="break-words text-sm text-slate-500">{{ onboarded_text(gateway, depot.byId) }}</p>
              <InService v-else :gateway="gateway"/>
            </template>

            <!-- The step the gateway is on. -->
            <ApproveForm v-else-if="kind === 'pending'" :gateway="gateway"/>

            <div v-else-if="kind === 'installing'" class="flex flex-col gap-4 text-sm">
              <AdminLogin :id="id"/>
              <p class="flex items-center gap-2 text-base font-semibold" role="status">
                <i class="fa-solid fa-circle-notch fa-spin text-slate-500" aria-hidden="true"></i>
                <span class="break-words">{{ install_text }}</span>
              </p>
              <p class="text-slate-500">
                {{ gateway.state === 'approved' ? 'Approved' : 'Started' }} {{ install_from ? ago(install_from, now.getTime()) : '' }}{{ gateway.approved_by ? ' by ' + gateway.approved_by : '' }}.
                The gateway powers off when the install finishes.
              </p>
              <details v-if="gateway.log" open>
                <summary class="cursor-pointer py-1 text-sm font-medium">Log from the installer</summary>
                <GatewayLog class="mt-2" :text="gateway.log"/>
              </details>
            </div>

            <div v-else-if="kind === 'failed-install'" class="flex flex-col gap-4 text-sm">
              <Alert variant="destructive">
                <AlertTitle class="font-semibold">The install failed.</AlertTitle>
                <AlertDescription>Nothing usable is on the disk, so this entry cannot continue.</AlertDescription>
              </Alert>
              <p>To start over:</p>
              <ol class="flex list-decimal flex-col gap-2 pl-5">
                <li class="pl-1">Remove this entry from the list.</li>
                <li class="pl-1">Power the gateway off and on again with the USB stick in, and it appears here again as a new gateway waiting for approval.</li>
              </ol>
              <div>
                <Button variant="destructive" :disabled="removing" @click="remove">Remove this entry</Button>
              </div>
              <details v-if="gateway.log">
                <summary class="cursor-pointer py-1 text-sm font-medium">Log from the gateway</summary>
                <GatewayLog class="mt-2" :text="gateway.log"/>
              </details>
            </div>

            <div v-else-if="kind === 'installed'" class="flex flex-col gap-4 text-sm">
              <p>The install finished and the gateway powered off. Now install it at the edge:</p>
              <ol class="flex list-decimal flex-col gap-2 pl-5">
                <li class="pl-1">Remove the USB stick.</li>
                <li class="pl-1">Carry the gateway to the edge.</li>
                <li class="pl-1">
                  {{ has_south ? 'Plug the site network cable into the northbound port and the machine’s cable into the southbound port.'
                    : 'Plug the site network cable into the northbound port.' }}
                </li>
                <li class="pl-1">Power it on.</li>
              </ol>
              <p class="break-words text-xs text-slate-500">{{ cabling }}</p>
              <p class="text-slate-500">Once the gateway is powered on at the edge, this page shows it as ready to onboard.</p>
            </div>

            <div v-else-if="kind === 'onboarding'" class="flex flex-col gap-4">
              <p class="break-words text-base font-semibold" role="status">{{ progress.step }}</p>
              <p class="text-sm text-slate-500">Started {{ progress.started ? ago(progress.started, now.getTime()) : '' }}{{ progress.by ? ' by ' + progress.by : '' }}. Onboarding takes 3 to 10 minutes.</p>
              <Alert v-if="!gateway.online" variant="destructive">
                <AlertDescription>
                  The gateway is not in contact{{ gateway.last_seen ? ', and was last seen ' + ago(gateway.last_seen, now.getTime()) : '' }}. Onboarding continues once the gateway is in contact again.
                </AlertDescription>
              </Alert>
              <div>
                <h3 class="mb-2 text-sm font-semibold">Log from the gateway</h3>
                <GatewayLog :text="gateway.log"/>
              </div>
            </div>

            <OnboardForm v-else :gateway="gateway" :failed="kind === 'failed-onboard'"/>
          </StepItem>
        </ol>
      </div>
    </DepotLoad>

    <template v-slot:sidebar>
      <div v-if="depot.loaded && !depot.forbidden && gateway" class="shrink-0 border-t border-border lg:w-96 lg:overflow-y-auto lg:border-l lg:border-t-0">
        <div class="flex w-full items-center gap-2 border-b p-4">
          <i class="fa-fw fa-solid fa-server"></i>
          <div class="text-xl font-semibold">Gateway Details</div>
        </div>
        <div class="space-y-4 p-4">
          <SidebarDetail icon="barcode" label="Serial number" :value="serial_of(gateway)"/>
          <SidebarDetail icon="microchip" label="Hardware" :value="hardware_of(gateway)"/>
          <SidebarDetail v-if="host_of(gateway)" icon="server" label="Hostname" :value="host_of(gateway)"/>
          <SidebarDetail v-if="note_of(gateway)" icon="tag" label="Note" :value="note_of(gateway)"/>
          <SidebarDetail v-if="gateway.uuid" icon="key" label="Factory+ ID" :value="String(gateway.uuid)"/>
          <SidebarDetail v-if="gateway.settings?.admin_user" icon="user" label="Admin user" :value="String(gateway.settings.admin_user)"/>
          <SidebarDetail v-if="cluster_name(gateway)" icon="circle-nodes" label="Cluster" :value="cluster_name(gateway)"/>
          <SidebarDetail v-if="gateway.report?.k3s" icon="cubes" label="k3s version" :value="String(gateway.report.k3s)"/>
          <SidebarDetail v-if="gateway.first_seen" icon="clock" label="First seen" :value="moment(gateway.first_seen).fromNow()" :title="new Date(gateway.first_seen).toLocaleString()"/>
        </div>
      </div>
    </template>
  </GatewayDepotContainer>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNow } from '@vueuse/core'
import moment from 'moment'
import { toast } from 'vue-sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import SidebarDetail from '@components/SidebarDetail.vue'
import GatewayDepotContainer from '@components/Containers/GatewayDepotContainer.vue'
import AdminLogin from '@components/GatewayDepot/AdminLogin.vue'
import ApproveForm from '@components/GatewayDepot/ApproveForm.vue'
import DepotLoad from '@components/GatewayDepot/DepotLoad.vue'
import GatewayLog from '@components/GatewayDepot/GatewayLog.vue'
import InService from '@components/GatewayDepot/InService.vue'
import OnboardForm from '@components/GatewayDepot/OnboardForm.vue'
import StatePill from '@components/GatewayDepot/StatePill.vue'
import StepItem from '@components/GatewayDepot/StepItem.vue'
import { useDialog } from '@/composables/useDialog'
import { useGatewayDepotStore } from '@store/useGatewayDepotStore.js'
import {
  ago, clean, clock, cluster_name, contact_of, hardware_of, host_of, kind_of, label_for, name_of, note_of,
  onboarded_text, relation_of, serial_of, settings_port, settings_rows, state_meta, steps_of, subline_of,
} from '@/lib/gateway-depot/model.js'

const depot = useGatewayDepotStore()
const route = useRoute()
const router = useRouter()
const now = useNow({ interval: 10000 })

const removing = ref(false)

const id = computed(() => String(route.params.id))
const gateway = computed(() => depot.byId.get(id.value) ?? null)
const kind = computed(() => kind_of(gateway.value))
const meta = computed(() => state_meta(gateway.value))
const steps = computed(() => steps_of(gateway.value))
const contact = computed(() => contact_of(gateway.value, now.value.getTime()))
const relation = computed(() => relation_of(gateway.value, depot.gateways))
const related = computed(() => (relation.value ? depot.byId.get(relation.value.id) ?? null : null))

/* When the gateway collected its settings, or failing that when it was
 * approved. */
const install_from = computed(() => gateway.value.install_started_at ?? gateway.value.approved_at ?? null)

/* What the installer says it is doing, as it reports each step. */
const install_text = computed(() => {
  if (gateway.value.state === 'approved') return 'Waiting for the gateway to start the install'
  const step = clean(gateway.value.install_step)
  return step ? 'Installing: ' + step : 'Installing the operating system'
})

const progress = computed(() => {
  const o = gateway.value.onboard || {}
  return { step: clean(o.step) || 'Starting', started: o.started, by: clean(o.by) }
})

/* Where the cables go once the gateway is at the edge. */
const has_south = computed(() => !!clean(gateway.value.settings && gateway.value.settings.south_mac))
const cabling = computed(() => {
  const gw = gateway.value, s = gw.settings || {}
  const port = mac => settings_port(gw, mac, ', ', 'MAC ')
  return ['Northbound: ' + (port(s.north_mac) || 'not recorded'),
    has_south.value ? 'Southbound: ' + port(s.south_mac) + (clean(s.south_addr) ? ', address ' + clean(s.south_addr) : '') : '',
  ].filter(Boolean).join('. ') + '.'
})

function remove () {
  const gw = gateway.value
  if (!gw) return
  const pending = gw.state === 'pending'
  const secret = depot.secrets[gw.id]
  const details = [pending ? 'This removes the gateway from the list and leaves its disk unchanged.'
    : 'This removes the record from the list and does not change the gateway.']
  if (secret && !secret.ack) details.push('The admin password for this gateway will not be shown again, so make a note of it first.')
  useDialog({
    title: pending ? 'Reject this gateway?' : 'Remove this gateway from the list?',
    message: name_of(gw) + ' · ' + (serial_of(gw) ? 'serial ' + serial_of(gw) : 'no serial number'),
    details,
    confirmText: pending ? 'Reject' : 'Remove',
    destructive: true,
    onConfirm: async () => {
      removing.value = true
      try {
        await depot.remove(gw.id)
        toast.success(pending ? 'Gateway rejected.' : 'Gateway removed from the list.')
        /* Stay while the page still holds this gateway's password. */
        if (!secret || secret.ack) router.push('/gateway-depot')
      }
      catch (err) {
        toast.error(err.message)
      }
      finally {
        removing.value = false
      }
    },
  })
}

onMounted(() => depot.start())
onUnmounted(() => depot.stop())
</script>

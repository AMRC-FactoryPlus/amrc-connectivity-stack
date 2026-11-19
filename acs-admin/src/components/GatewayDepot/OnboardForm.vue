<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Step 4: onboard a gateway that is at the edge. It creates a new
     edge cluster, joins an existing one, or (for a replacement) takes
     over the old gateway's cluster. Also shown after onboarding failed,
     to try again.

     The choices are kept in the store so the periodic refresh leaves
     them alone. The join token is a secret: it is held in this
     component only, and is gone once it has been sent. -->
<template>
  <div class="flex flex-col gap-4">
    <template v-if="failed">
      <Alert variant="destructive">
        <AlertTitle class="font-semibold">Onboarding failed.</AlertTitle>
        <AlertDescription class="break-words">{{ reason }}</AlertDescription>
      </Alert>
      <details v-if="gateway.log" open>
        <summary class="cursor-pointer py-1 text-sm font-medium">Log from the gateway</summary>
        <GatewayLog class="mt-2" :text="gateway.log"/>
      </details>
      <p v-if="!replacing" class="text-sm">Correct the details below and try again.</p>
    </template>

    <div class="flex flex-col gap-2 rounded-lg bg-slate-100 p-4 text-sm">
      <h3 class="font-semibold">Install the gateway at the edge first</h3>
      <p>The cluster permanently records this gateway’s northbound address when you onboard it, so only onboard it once it is at the edge.</p>
    </div>

    <div>
      <h3 class="mb-2 text-sm font-semibold">Ports</h3>
      <PortTiles :gateway-id="gateway.id" :nics="ports.nics" :role="ports.role" copy/>
    </div>

    <div v-if="replacing" class="flex flex-col gap-2 rounded-lg bg-slate-100 p-4 text-sm">
      <h3 class="font-semibold">This gateway replaces another</h3>
      <p>{{ takeover }}</p>
    </div>

    <Alert v-if="!gateway.online" variant="destructive">
      <AlertDescription>
        This gateway is not in contact, so it cannot be onboarded yet.{{ gateway.last_seen ? ' It was last seen ' + ago(gateway.last_seen, now.getTime()) + '.' : '' }}
        Check that it is powered on and that its northbound cable is plugged in.
      </AlertDescription>
    </Alert>

    <form class="flex max-w-xl flex-col gap-5" novalidate autocomplete="off" ref="form" @submit.prevent="submit">
      <OptionList v-if="!replacing" legend="How to onboard" :options="MODES" :model-value="F.mode"
          @update:model-value="v => F.mode = v"/>

      <template v-if="replacing"></template>
      <FormField v-else-if="F.mode === 'create'" label="Cluster name" :invalid="v$.cluster.$error">
        <Input :model-value="F.cluster" input-class="text-base lg:text-sm" :v="v$.cluster"
            @update:model-value="v => { F.cluster = v; F.touchedCluster = true }"/>
        <template #after>
          <p v-if="name_taken" class="text-xs font-medium text-amber-700">
            Factory+ already has a cluster with this name. Choose another name unless you mean that cluster.
          </p>
        </template>
      </FormField>
      <template v-else>
        <OptionList legend="Which edge cluster is this gateway joining?"
            info="The cluster’s control plane gateway must be in service and in contact."
            :options="server_options" :model-value="F.server" :error="message('server')"
            @update:model-value="v => F.server = v"/>
        <template v-if="manual">
          <FormField label="Address of the cluster" :invalid="v$.url.$error">
            <Input :model-value="F.url" type="url" placeholder="https://host:6443" input-class="text-base lg:text-sm" :v="v$.url"
                @update:model-value="v => F.url = v"/>
          </FormField>
          <FormField label="Join token" :error="message('token')"
              info="To get the join token, run this command on the cluster’s control plane gateway:">
            <SecretInput v-model="token" :invalid="v$.token.$error"/>
            <template #after>
              <div class="flex flex-wrap items-center gap-2">
                <code class="min-w-0 flex-1 basis-52 select-all break-all rounded-md bg-slate-100 px-3 py-2 font-mono text-[0.8125rem]">{{ TOKEN_COMMAND }}</code>
                <Button type="button" variant="outline" size="sm" class="gap-2" aria-label="Copy the command" @click="copy_text(TOKEN_COMMAND, 'Command')">
                  <i class="fa-solid fa-copy"></i>Copy
                </Button>
              </div>
            </template>
          </FormField>
        </template>
      </template>

      <Alert v-if="failure" variant="destructive">
        <AlertDescription class="break-words">{{ failure }}</AlertDescription>
      </Alert>

      <div class="flex flex-wrap items-center gap-3">
        <Button type="submit" class="gap-2" :disabled="busy || !gateway.online">
          <i v-if="busy" class="fa-solid fa-circle-notch animate-spin"></i>
          {{ busy ? 'Starting' : failed ? 'Try again' : 'Start onboarding' }}
        </Button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, toRef, watch, watchEffect } from 'vue'
import { useNow } from '@vueuse/core'
import useVuelidate from '@vuelidate/core'
import { helpers } from '@vuelidate/validators'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useGatewayDepotStore } from '@store/useGatewayDepotStore.js'
import { copy_text } from '@/lib/gateway-depot/copy.js'
import { ago, clean, cluster_name, configured_ports, host_of, label_for } from '@/lib/gateway-depot/model.js'
import {
  MANUAL, TOKEN_COMMAND, cluster_name_taken, join_choices, join_options, needs_manual, new_onboard_form,
  onboard_body, validate_onboard,
} from '@/lib/gateway-depot/onboard.js'
import FormField from './FormField.vue'
import GatewayLog from './GatewayLog.vue'
import OptionList from './OptionList.vue'
import PortTiles from './PortTiles.vue'
import SecretInput from './SecretInput.vue'

const props = defineProps({
  gateway: { type: Object, required: true },
  /* Onboarding was tried and failed. */
  failed: { type: Boolean, default: false },
})

const MODES = [
  { value: 'create', title: 'Create a new edge cluster', detail: 'The usual choice.' },
  { value: 'join', title: 'Join an existing edge cluster', detail: 'Rare.' },
]

const depot = useGatewayDepotStore()
const now = useNow({ interval: 10000 })

const slot = depot.form(props.gateway.id)
if (!slot.onboard) slot.onboard = new_onboard_form(props.gateway)
const F = slot.onboard

/* Set at approval, so it does not change under the form. */
const replacing = !!props.gateway.replaces

const form = ref(null)
const token = ref('')
const busy = ref(false)
const failure = ref('')

const reason = computed(() => clean(props.gateway.onboard && props.gateway.onboard.error) || 'The gateway did not report a reason.')
const ports = computed(() => configured_ports(props.gateway))
const takeover = computed(() => {
  const from = depot.byId.get(props.gateway.replaces)
  return 'The gateway takes over the edge cluster ' + (from && cluster_name(from) ? cluster_name(from) + ' ' : '')
    + 'from ' + (from ? label_for(from) : 'the gateway it replaces') + '.'
})

const choices = computed(() => join_choices(depot.clusters, depot.gateways, props.gateway))
const server_options = computed(() => join_options(choices.value, now.value.getTime()))
const picked = computed(() => choices.value.find(c => c.key === F.server) ?? null)
const manual = computed(() => needs_manual(F.server, picked.value))
const name_taken = computed(() => !replacing && cluster_name_taken(F.cluster, depot.clusters, props.gateway))

/* The cluster list is short-lived, so ask again as the gateway reports. */
onMounted(() => depot.loadClusters())
watch(() => props.gateway, () => depot.loadClusters())

watchEffect(() => {
  /* The hostname is the usual cluster name, once the gateway reports it. */
  const host = host_of(props.gateway)
  if (!F.touchedCluster && !F.cluster && host) F.cluster = host
  /* A cluster that has gone from the list cannot stay chosen. */
  if (F.server && F.server !== MANUAL && !choices.value.some(c => c.key === F.server)) F.server = null
})

const problems = computed(() => validate_onboard(F, token.value, choices.value, replacing))
const rule = field => ({
  valid: helpers.withMessage(() => problems.value[field] ?? '', () => !problems.value[field]),
})
const v$ = useVuelidate({
  cluster: rule('cluster'), server: rule('server'), url: rule('url'), token: rule('token'),
}, { cluster: toRef(F, 'cluster'), server: toRef(F, 'server'), url: toRef(F, 'url'), token })
const message = field => (v$.value[field].$error ? problems.value[field] ?? null : null)

async function submit () {
  failure.value = ''
  if (busy.value || !props.gateway.online) return
  if (!await v$.value.$validate()) {
    await nextTick()
    const first = form.value?.querySelector('[data-invalid="true"]')
    first?.scrollIntoView({ block: 'center' })
    first?.querySelector('input:not(:disabled)')?.focus({ preventScroll: true })
    return
  }
  const body = onboard_body(F, token.value, choices.value, replacing)
  busy.value = true
  try {
    await depot.onboard(props.gateway.id, body)
    token.value = ''
  }
  catch (err) {
    failure.value = err.message
  }
  finally {
    busy.value = false
  }
}
</script>

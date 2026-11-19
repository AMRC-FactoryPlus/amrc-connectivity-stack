<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Step 1: check a waiting gateway against its label, choose its
     ports and disk, and approve it. Approving erases the disk, so it
     asks first.

     What the person has chosen is kept in the store, apart from the
     gateway the service reports, so the periodic refresh updates the
     ports and disks on show without touching a choice or a cursor. -->
<template>
  <form class="flex flex-col gap-5" novalidate autocomplete="off" ref="form" @submit.prevent="submit">
    <div class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-slate-100 p-4">
      <div>
        <div class="text-xs text-slate-500">Serial number</div>
        <div v-if="serial" class="select-all break-all font-mono text-3xl font-semibold tracking-wider">{{ serial }}</div>
        <div v-else class="text-xl font-semibold">Not reported</div>
      </div>
      <p class="min-w-0 flex-1 basis-60 text-sm">
        {{ serial ? 'Compare this with the label on the gateway before you approve.'
          : 'This gateway did not report a usable serial number, so identify it by the MAC addresses of its ports below.' }}
      </p>
    </div>
    <p class="text-xs text-slate-500">{{ facts }}</p>

    <FormField v-if="candidates.length" label="Does this gateway replace one that has died?" class="max-w-2xl">
      <Select :model-value="F.replaces || NEW_GATEWAY" @update:model-value="choose_replaces">
        <SelectTrigger class="h-10 text-base lg:text-sm">
          <SelectValue/>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem :value="NEW_GATEWAY">No, this is a new gateway</SelectItem>
            <SelectItem v-for="c in candidates" :key="c.id" :value="c.id">
              {{ label_for(c) }} · {{ c.online ? 'in contact' : 'not in contact' }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <template #after>
        <div v-if="old" class="mt-1 flex flex-col gap-2 rounded-lg bg-slate-100 p-4 text-sm">
          <p>This gateway takes over the edge cluster {{ cluster_name(old) }} from {{ label_for(old) }}.</p>
          <label class="flex min-h-9 cursor-pointer items-center gap-2">
            <Checkbox :model-value="F.keepName" @update:model-value="v => F.keepName = !!v"/>
            {{ keep_name_text(old) }}
          </label>
          <p>
            {{ F.keepName ? 'With the same hostname, the devices deployed to the old gateway start on this one.'
              : 'This gateway gets a new hostname from its serial number, so you must move each deployment to it by hand in another tool.' }}
          </p>
          <p>Connection secrets entered for the old gateway, such as a driver’s password, do not carry over, so enter them again in the Factory+ admin tool once this gateway is in service.</p>
          <p class="text-xs text-slate-500">The form now starts from the old gateway’s settings, so check the ports before you approve.</p>
        </div>
      </template>
    </FormField>

    <div class="grid gap-x-8 gap-y-6 xl:grid-cols-2">
      <div class="flex min-w-0 flex-col gap-5">
        <h3 class="text-sm font-semibold">Network ports</h3>
        <div>
          <p class="mb-2 text-sm text-slate-500">To find a port, plug or unplug a cable and watch which one changes.</p>
          <PortTiles :gateway-id="gateway.id" :nics="view.nics" :role="tile_role"/>
        </div>
        <OptionList legend="Northbound port" info="Connects the gateway to the site network."
            :options="view.north_options" :model-value="F.north" :error="message('north')"
            @update:model-value="choose_north"/>
        <OptionList legend="Southbound port" info="Connects the gateway to the machine network."
            :options="view.south_options" :model-value="F.south" :error="message('south')"
            @update:model-value="choose_south"/>
        <FormField v-if="F.south !== ''" label="Southbound address" :invalid="v$.addr.$error"
            info="An address with a prefix length, or the word dhcp.">
          <Input :model-value="F.addr" placeholder="e.g. 192.168.1.200/24" input-class="text-base lg:text-sm" :v="v$.addr"
              @update:model-value="v => typed('addr', v)"/>
        </FormField>
      </div>
      <div class="flex min-w-0 flex-col gap-5">
        <h3 class="text-sm font-semibold">Install settings</h3>
        <OptionList legend="Disk to install on" info="The install erases everything on this disk."
            :options="view.disk_options" :model-value="F.disk" :error="message('disk')"
            @update:model-value="choose_disk"/>
        <Alert v-if="!view.disks.length" variant="destructive">
          <AlertDescription>This gateway did not report any disks.</AlertDescription>
        </Alert>
        <FormField label="Admin username" :invalid="v$.admin.$error"
            info="This user is created on the gateway, and the password is shown once after you approve.">
          <Input :model-value="F.admin" input-class="text-base lg:text-sm" :v="v$.admin"
              @update:model-value="v => typed('admin', v)"/>
        </FormField>
        <FormField label="Note" optional info="A few words to tell this gateway apart from the others.">
          <Input :model-value="F.note" placeholder="e.g. tapeline" input-class="text-base lg:text-sm"
              @update:model-value="v => typed('note', v)"/>
        </FormField>
        <FormField label="SSH public keys" optional info="One key per line, for the admin user." :error="message('keys')">
          <textarea v-model="F.keys" rows="3" placeholder="ssh-ed25519 AAAA..." autocomplete="off" autocapitalize="none" spellcheck="false"
              class="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:text-[0.8125rem]"
              :class="v$.keys.$error ? 'border-red-500' : ''"></textarea>
        </FormField>
      </div>
    </div>

    <Alert v-if="failure" variant="destructive">
      <AlertDescription>{{ failure }}</AlertDescription>
    </Alert>

    <div class="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-red-200 p-4">
      <p class="min-w-0 flex-1 basis-72 break-words text-sm font-medium text-red-600">
        {{ chosen_disk ? 'Approving erases ' + disk_line(chosen_disk) + '. This cannot be undone.'
          : 'Approving erases the disk you choose. This cannot be undone.' }}
      </p>
      <Button type="submit" variant="destructive" class="gap-2" :disabled="busy || !view.disks.length">
        <i v-if="busy" class="fa-solid fa-circle-notch animate-spin"></i>
        {{ busy ? 'Approving' : 'Erase disk and install' }}
      </Button>
    </div>

    <Dialog :open="confirming" @update:open="v => { if (!v) confirming = false }">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Erase this disk and install?</DialogTitle>
          <DialogDescription as="div" class="flex flex-col gap-1.5 break-words text-left">
            <p v-for="(l, i) in lines" :key="i" :class="l.strong ? 'font-medium text-slate-950' : ''">{{ l.text }}</p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2">
          <Button type="button" variant="outline" @click="confirming = false">Cancel</Button>
          <Button type="button" variant="destructive" @click="approve">Erase disk and install</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </form>
</template>

<script setup>
import { computed, nextTick, ref, watch, watchEffect } from 'vue'
import { useNow } from '@vueuse/core'
import useVuelidate from '@vuelidate/core'
import { helpers } from '@vuelidate/validators'
import { toast } from 'vue-sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGatewayDepotStore } from '@store/useGatewayDepotStore.js'
import { cluster_name, facts_of, label_for, replace_candidates, secret_name, serial_of } from '@/lib/gateway-depot/model.js'
import {
  NEW_GATEWAY, approve_body, approve_view, disk_line, erase_lines, keep_name_text, new_approve_form,
  old_choices, south_after_north, validate_approve,
} from '@/lib/gateway-depot/approve.js'
import FormField from './FormField.vue'
import OptionList from './OptionList.vue'
import PortTiles from './PortTiles.vue'

const props = defineProps({
  gateway: { type: Object, required: true },
})

const depot = useGatewayDepotStore()
const now = useNow({ interval: 10000 })

/* The form outlives this component: leaving the page and coming back
 * finds it as it was. */
const slot = depot.form(props.gateway.id)
if (!slot.approve) slot.approve = new_approve_form(depot.defaultAdminUser)
const F = slot.approve

const form = ref(null)
const busy = ref(false)
const confirming = ref(false)
const failure = ref('')

const serial = computed(() => serial_of(props.gateway))
const facts = computed(() => facts_of(props.gateway, now.value.getTime()))
const candidates = computed(() => replace_candidates(depot.gateways, props.gateway.id))
const old = computed(() => (F.replaces ? candidates.value.find(c => c.id === F.replaces) ?? null : null))
const view = computed(() => approve_view(F, props.gateway, old.value))
const chosen_disk = computed(() => view.value.disks.find(d => d.path === F.disk) ?? null)
const lines = computed(() => erase_lines(F, props.gateway, old.value))

/* Keep the choices in step with the ports and disks the gateway
 * reports. This only ever changes a field the person has not chosen,
 * or one whose port or disk has gone. */
watchEffect(() => {
  const v = view.value
  if (F.north !== v.north) F.north = v.north
  if (F.south !== v.south) F.south = v.south
  if (F.disk !== v.disk) F.disk = v.disk
  if (F.replaces && depot.loaded && !candidates.value.some(c => c.id === F.replaces)) F.replaces = ''
})

/* The service's default admin user may arrive after the form opens. */
watch(() => depot.defaultAdminUser, name => {
  if (name && !F.admin && !F.touched.admin) F.admin = name
})

const tile_role = n => (n.mac && n.mac === F.north ? 'Northbound' : n.mac && n.mac === F.south ? 'Southbound' : '')

function typed (field, value) {
  F[field] = value
  F.touched[field] = true
}

function choose_north (mac) {
  F.south = south_after_north(F.south, mac, view.value.nics)
  F.north = mac
  F.touched.north = true
}

function choose_south (mac) {
  F.south = mac
  F.touched.south = true
}

function choose_disk (path) {
  F.disk = path
  F.touched.disk = true
}

function choose_replaces (id) {
  F.replaces = id === NEW_GATEWAY ? '' : id
  const from = depot.byId.get(F.replaces)
  if (from) Object.assign(F, old_choices(F, from))
}

/* Vuelidate tracks which fields to show errors for; the checks
 * themselves are plain functions shared with the unit tests. */
const problems = computed(() => validate_approve(F))
const rule = field => ({
  valid: helpers.withMessage(() => problems.value[field] ?? '', () => !problems.value[field]),
})
const v$ = useVuelidate({
  north: rule('north'), south: rule('south'), addr: rule('addr'),
  disk: rule('disk'), admin: rule('admin'), keys: rule('keys'),
}, F)
const message = field => (v$.value[field].$error ? problems.value[field] ?? null : null)

async function submit () {
  failure.value = ''
  if (busy.value) return
  if (!await v$.value.$validate()) {
    await nextTick()
    const first = form.value?.querySelector('[data-invalid="true"]')
    first?.scrollIntoView({ block: 'center' })
    first?.querySelector('input:not(:disabled), textarea')?.focus({ preventScroll: true })
    return
  }
  confirming.value = true
}

async function approve () {
  confirming.value = false
  if (busy.value) return
  busy.value = true
  try {
    await depot.approve(props.gateway.id, approve_body(F, old.value), secret_name(props.gateway, F.note))
    toast.success('Approved. Make a note of the admin password now.')
  }
  catch (err) {
    failure.value = err.message
  }
  finally {
    busy.value = false
  }
}
</script>

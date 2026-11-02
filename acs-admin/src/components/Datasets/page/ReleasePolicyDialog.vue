<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!-- Edit the terms a dataset is released under. A change applies to
     the next briefcase: a released one never changes. Call
     open(record) through a ref. -->
<template>
  <Dialog :open="!!target" @update:open="v => !v && close()">
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Release policy</DialogTitle>
        <DialogDescription>
          The terms this dataset is released under. Every briefcase built from it carries them.
          A change applies to the next briefcase, not one already released.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <Label for="rp-tier">Who may have the data</Label>
          <select id="rp-tier" v-model="form.tier" :class="field">
            <option v-for="(text, id) in TIERS" :key="id" :value="id">{{ text }}</option>
          </select>
        </div>

        <div class="flex flex-col gap-1">
          <Label for="rp-org">Data owner</Label>
          <input id="rp-org" v-model="form.organisation" placeholder="Organisation" :class="field"/>
          <p v-if="shown.organisation" class="text-xs text-red-600">{{ shown.organisation }}</p>
        </div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <Label for="rp-name">Contact name</Label>
            <input id="rp-name" v-model="form.contact_name" :class="field"/>
            <p v-if="shown.contact_name" class="text-xs text-red-600">{{ shown.contact_name }}</p>
          </div>
          <div class="flex flex-col gap-1">
            <Label for="rp-email">Contact email</Label>
            <input id="rp-email" v-model="form.contact_email" type="email" :class="field"/>
            <p v-if="shown.contact_email" class="text-xs text-red-600">{{ shown.contact_email }}</p>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <Label>Terms</Label>
          <div class="flex gap-4 text-sm">
            <label class="flex items-center gap-1.5"><input v-model="form.terms" type="radio" value="licence"/>Licence</label>
            <label class="flex items-center gap-1.5"><input v-model="form.terms" type="radio" value="agreement"/>Data sharing agreement</label>
          </div>
          <input v-model="form.terms_value" :aria-label="form.terms === 'agreement' ? 'Agreement reference' : 'Licence'"
                 :placeholder="form.terms === 'agreement' ? 'Agreement reference' : 'SPDX identifier, such as CC-BY-4.0'" :class="field"/>
          <p v-if="shown.terms_value" class="text-xs text-red-600">{{ shown.terms_value }}</p>
        </div>

        <div class="flex flex-col gap-1">
          <Label for="rp-use">Permitted use</Label>
          <textarea id="rp-use" v-model="form.permitted_use" rows="3"
                    placeholder="One paragraph, shown to everyone who gets the data"
                    class="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"></textarea>
          <p v-if="shown.permitted_use" class="text-xs text-red-600">{{ shown.permitted_use }}</p>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="flex flex-col gap-1">
            <Label for="rp-trial">Trial (optional)</Label>
            <input id="rp-trial" v-model="form.trial" :class="field"/>
          </div>
          <div class="flex flex-col gap-1">
            <Label for="rp-embargo">Embargo until (optional)</Label>
            <input id="rp-embargo" v-model="form.embargo_until" type="date" :class="field"/>
            <p v-if="shown.embargo_until" class="text-xs text-red-600">{{ shown.embargo_until }}</p>
          </div>
          <div class="flex flex-col gap-1">
            <Label for="rp-review">Review by (optional)</Label>
            <input id="rp-review" v-model="form.review_by" type="date" :class="field"/>
            <p v-if="shown.review_by" class="text-xs text-red-600">{{ shown.review_by }}</p>
          </div>
        </div>
      </div>

      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

      <DialogFooter>
        <Button variant="outline" @click="close">Cancel</Button>
        <Button :disabled="busy" @click="save">
          <i v-if="busy" class="fa-solid fa-circle-notch animate-spin mr-2"></i>Save policy
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import {
  TIERS, release_policy, policy_form, policy_problems, form_policy, save_release_policy,
} from '@/lib/datasets/release.js'

const field = 'h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2'

const target = ref(null)
const form = ref(policy_form(null))
const tried = ref(false)
const busy = ref(false)
const error = ref(null)

const problems = computed(() => policy_problems(form.value))
// Say what is wrong only once someone has tried to save.
const shown = computed(() => tried.value ? problems.value : {})

function open (record) {
  target.value = record
  form.value = policy_form(release_policy(record))
  tried.value = false
  error.value = null
}

function close () { target.value = null }

async function save () {
  tried.value = true
  if (Object.keys(problems.value).length) return
  busy.value = true
  error.value = null
  try {
    const sc = useServiceClientStore()
    await save_release_policy(sc.client, target.value.uuid, form_policy(form.value))
    toast.success('Release policy saved')
    close()
  }
  catch (err) {
    error.value = err?.status === 403 ? 'You do not have permission to change the release policy.'
      : err?.status === 422 ? 'ConfigDB refused the policy as invalid. Check the email address and dates.'
      : (err?.message ?? 'The policy was not saved.')
  }
  finally {
    busy.value = false
  }
}

defineExpose({ open })
</script>

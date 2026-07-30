<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<!--
  - Publish.
  -
  - This is not a confirmation. The author has no decision to make: the
  - classifier decides whether the schema updates in place or forks to a
  - new version. So the screen is a statement of consequence. The outcome
  - comes first in one sentence, then the evidence that produced it.
  -
  - The change list and the affected devices are supporting material
  - below the verdict, not a stack of warnings to be cleared.
  -->

<template>
  <div class="flex h-[calc(100vh-4rem)] flex-col -m-4">
    <Skeleton v-if="loading" class="m-3 h-full rounded-lg"/>

    <div v-else-if="loadError"
        class="flex flex-1 flex-col items-center justify-center gap-3 p-10">
      <i class="fa-solid fa-triangle-exclamation fa-2x text-amber-500"></i>
      <p class="text-sm text-gray-600">{{ loadError }}</p>
      <Button variant="outline" @click="$router.push('/schemas')">Back to schemas</Button>
    </div>

    <template v-else>
      <div class="flex h-16 shrink-0 items-center justify-between border-b
                  border-slate-200 px-4">
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-rocket text-slate-500"></i>
          <h3 class="text-lg font-bold tracking-tight">Publish {{ name }}</h3>
        </div>
        <Button variant="ghost" size="sm" class="text-slate-500" @click="back">
          <i class="fa-solid fa-times mr-2"></i>Cancel
        </Button>
      </div>

      <div class="flex-1 overflow-y-auto p-5">
        <div class="mx-auto flex max-w-5xl flex-col gap-4">

          <!-- Blocked. Nothing else on the page matters until this is
               resolved, so it replaces the verdict rather than sitting
               alongside it. -->
          <div v-if="unresolved.length"
              class="flex flex-col gap-3.5 rounded-lg border border-slate-200 bg-white p-5
                     shadow-sm">
            <div class="flex items-start gap-3">
              <i class="fa-solid fa-circle-pause mt-0.5 text-base text-slate-500"></i>
              <div>
                <div class="mb-1 text-[17px] font-semibold tracking-tight">
                  This schema cannot publish yet.
                </div>
                <div class="text-sm leading-relaxed text-gray-700">
                  It uses
                  <span class="font-medium">{{ blockingNames }}</span>,
                  {{ unresolved.length === 1 ? 'which is' : 'which are' }} still
                  {{ unresolved.length === 1 ? 'a draft' : 'drafts' }}.
                  Publish {{ unresolved.length === 1 ? 'it' : 'them' }} before
                  publishing this schema.
                </div>
              </div>
            </div>
            <div v-for="ref in unresolved" :key="ref"
                class="flex items-center gap-2.5 rounded-md border border-slate-200
                       px-3 py-2.5">
              <i class="fa-solid fa-cube text-xs text-slate-700"></i>
              <span class="text-sm font-medium">{{ nameFor(ref) }}</span>
              <Badge variant="outline" class="gap-1.5 border-dashed font-normal">
                <i class="fa-solid fa-pen text-[8px]"></i>Draft
              </Badge>
              <Button v-if="draftFor(ref)" variant="outline" size="xs" class="ml-auto"
                  @click="$router.push(`/schemas/draft/${draftFor(ref)}`)">
                Open {{ nameFor(ref) }}
              </Button>
            </div>
            <div class="flex gap-2">
              <Button disabled><i class="fa-solid fa-rocket mr-2"></i>Publish</Button>
              <Button variant="ghost" class="text-slate-500" @click="back">
                Keep editing
              </Button>
            </div>
          </div>

          <template v-else>
            <!-- Verdict -->
            <div class="flex items-center gap-6 rounded-lg border border-slate-300 bg-white
                        p-5 shadow-sm">
              <div class="flex shrink-0 items-center gap-2.5">
                <template v-if="forks">
                  <div class="flex flex-col items-center gap-1">
                    <div class="flex h-13 w-13 items-center justify-center rounded-md border
                                border-slate-200 font-mono text-xl font-semibold text-slate-500"
                        style="height:52px;width:52px">
                      v{{ version }}
                    </div>
                    <span class="text-[10px] text-gray-400">superseded</span>
                  </div>
                  <i class="fa-solid fa-arrow-right text-slate-300"></i>
                </template>
                <div class="flex flex-col items-center gap-1">
                  <div class="flex items-center justify-center rounded-md font-mono text-xl
                              font-semibold"
                      :class="forks
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 text-slate-900'"
                      style="height:52px;width:52px">
                    v{{ newVersion }}
                  </div>
                  <span class="text-[10px] text-gray-400">{{ forks ? 'new' : 'updated' }}</span>
                </div>
              </div>
              <div class="flex-1">
                <div class="mb-1.5 text-xl font-semibold leading-snug tracking-tight">
                  {{ verdict }}
                </div>
                <div class="text-sm leading-relaxed text-gray-700">{{ verdictDetail }}</div>
              </div>
            </div>

            <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_300px]">
              <!-- Changes -->
              <div class="overflow-hidden rounded-lg border border-slate-200 shadow-sm">
                <div class="flex items-center justify-between border-b border-slate-200
                            px-4 py-3">
                  <span class="text-sm font-semibold">{{ changeHeading }}</span>
                  <Button variant="ghost" size="xs" class="text-slate-500"
                      @click="rawOpen = true">
                    <i class="fa-solid fa-code mr-2"></i>View JSON
                  </Button>
                </div>

                <template v-if="breakingChanges.length">
                  <div class="flex items-center gap-2 border-b border-slate-200 bg-amber-50
                              px-4 py-2">
                    <i class="fa-solid fa-triangle-exclamation text-[11px] text-amber-700"></i>
                    <span class="text-xs font-semibold uppercase tracking-wide text-amber-900">
                      {{ breakingChanges.length }} breaking
                    </span>
                    <span class="text-xs text-amber-800">
                      A device configured for v{{ version }} would no longer match
                    </span>
                  </div>
                  <div class="py-1">
                    <div v-for="(change, i) in breakingChanges" :key="`b${i}`"
                        class="flex items-baseline gap-3 px-4 py-2.5">
                      <span class="min-w-[200px] shrink-0 font-mono text-[13px]">
                        {{ subject(change) }}
                      </span>
                      <span class="text-sm text-gray-700">{{ predicate(change) }}</span>
                    </div>
                  </div>
                </template>

                <template v-if="additiveChanges.length">
                  <div class="flex items-center gap-2 border-y border-slate-200 bg-gray-50
                              px-4 py-2">
                    <i class="fa-solid fa-plus text-[11px] text-green-600"></i>
                    <span class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {{ additiveChanges.length }} additive
                    </span>
                    <span class="text-xs text-gray-500">
                      {{ breakingChanges.length ? 'Safe on their own' : 'No breaking changes' }}
                    </span>
                  </div>
                  <div class="py-1">
                    <div v-for="(change, i) in shownAdditive" :key="`a${i}`"
                        class="flex items-baseline gap-3 px-4 py-2.5">
                      <span class="min-w-[200px] shrink-0 font-mono text-[13px]">
                        {{ subject(change) }}
                      </span>
                      <span class="text-sm text-gray-700">{{ predicate(change) }}</span>
                    </div>
                    <button v-if="additiveChanges.length > shownAdditive.length"
                        class="px-4 py-2 text-xs text-slate-500 hover:text-slate-900"
                        @click="showAllAdditive = true">
                      Show {{ additiveChanges.length - shownAdditive.length }} more
                    </button>
                  </div>
                </template>

                <div v-if="!changes.length" class="px-4 py-6 text-center text-sm text-gray-500">
                  Nothing has changed since version {{ version }}.
                </div>
              </div>

              <!-- Reach -->
              <div class="flex flex-col gap-3">
                <div class="overflow-hidden rounded-lg border border-slate-200 shadow-sm">
                  <div class="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
                    Affected devices
                  </div>
                  <div class="flex flex-col gap-4 p-4">
                    <div>
                      <div class="flex items-baseline gap-2">
                        <span class="text-[28px] font-semibold leading-none tracking-tight">
                          {{ configured.length }}
                        </span>
                        <span class="text-sm text-gray-500">configured</span>
                      </div>
                      <div class="mt-1 text-xs leading-relaxed text-gray-500">
                        Devices whose origin map points at this schema.
                      </div>
                    </div>

                    <div class="h-px bg-slate-200"></div>

                    <div>
                      <div class="flex items-center gap-2">
                        <template v-if="publishing !== null">
                          <span class="text-[28px] font-semibold leading-none tracking-tight">
                            {{ publishing.length }}
                          </span>
                          <span class="text-sm text-gray-500">publishing now</span>
                          <i v-if="publishing.length"
                              class="fa-solid fa-circle text-[6px] text-green-500"></i>
                        </template>
                        <template v-else>
                          <span class="text-[22px] font-semibold tracking-tight text-gray-400">
                            Unknown
                          </span>
                          <Button variant="ghost" size="xs" class="text-slate-500"
                              @click="loadReach">
                            <i class="fa-solid fa-rotate-right mr-1.5 text-[10px]"></i>Retry
                          </Button>
                        </template>
                      </div>
                      <div class="mt-1 text-xs leading-relaxed text-gray-500">
                        {{ publishing === null
                          ? 'The Directory is unreachable. The configured count is unaffected.'
                          : 'Seen on the most recent Sparkplug session.' }}
                      </div>
                    </div>

                    <template v-if="configured.length">
                      <div class="h-px bg-slate-200"></div>
                      <div class="flex flex-col gap-1.5">
                        <div v-for="device in configured.slice(0, 6)" :key="device.uuid"
                            class="flex items-center gap-2 text-xs"
                            :class="isLive(device) ? '' : 'text-slate-500'">
                          <i class="fa-solid fa-circle text-[6px]"
                              :class="isLive(device) ? 'text-green-500' : 'text-slate-400'"></i>
                          <span class="truncate font-mono">{{ device.name ?? device.uuid }}</span>
                          <span class="ml-auto shrink-0 text-gray-400">
                            {{ isLive(device) ? 'live' : 'offline' }}
                          </span>
                        </div>
                        <div v-if="configured.length > 6" class="text-xs text-gray-400">
                          and {{ configured.length - 6 }} more
                        </div>
                      </div>
                    </template>

                    <template v-if="referencedBy.length">
                      <div class="h-px bg-slate-200"></div>
                      <div class="text-xs leading-relaxed text-gray-500">
                        {{ referencedBy.length }}
                        {{ referencedBy.length === 1 ? 'other schema uses' : 'other schemas use' }}
                        this as a component.
                      </div>
                    </template>
                  </div>
                </div>

                <Button class="w-full" :disabled="!canPublish || working" @click="publish">
                  <i v-if="working" class="fa-solid fa-circle-notch fa-spin mr-2"></i>
                  <i v-else class="fa-solid fa-rocket mr-2"></i>
                  {{ actionLabel }}
                </Button>
                <Button variant="ghost" class="w-full text-slate-500" @click="back">
                  Keep editing
                </Button>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>

    <RawSchemaDialog v-model:open="rawOpen" :body="body" :read-only="true"/>
  </div>
</template>

<script>
import { toast } from 'vue-sonner'
import { v4 as uuidv4 } from 'uuid'

import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Skeleton } from '@components/ui/skeleton/index.js'
import RawSchemaDialog from '@components/Schemas/RawSchemaDialog.vue'

import { useSchemaStore } from '@store/useSchemaStore.js'
import { useSchemaDraftStore } from '@store/useSchemaDraftStore.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { storeReady } from '@store/useStoreReady.js'

import { classify } from '@/lib/schema/classify.js'
import { parse, referencedSchemas, serialise } from '@/lib/schema/document.js'
import { blastRadius } from '@/lib/schema/usage.js'
import {
  deleteDraft, publishInPlace, publishNew, unresolvedReferences, versionOf,
} from '@/lib/schema/registry.js'

export default {
  name: 'PublishSchema',

  components: { Badge, Button, RawSchemaDialog, Skeleton },

  setup () {
    return {
      sch: useSchemaStore(),
      drafts: useSchemaDraftStore(),
      dev: useDeviceStore(),
      s: useServiceClientStore(),
    }
  },

  data () {
    return {
      loading: true,
      loadError: null,
      working: false,
      rawOpen: false,
      showAllAdditive: false,
      draftUuid: null,
      name: '',
      version: 1,
      schemaUuid: null,
      basedOn: null,
      derivedFrom: null,
      body: {},
      changes: [],
      breaking: false,
      configured: [],
      publishing: null,
      referencedBy: [],
      unresolved: [],
    }
  },

  async mounted () {
    await Promise.all([this.sch.start(), this.drafts.start(), this.dev.start()])
    /* start() resolves before the stores hold anything. */
    await Promise.all([
      storeReady(this.sch), storeReady(this.drafts), storeReady(this.dev),
    ])
    await this.load()
  },

  computed: {
    breakingChanges () {
      return this.changes.filter(c => c.breaking)
    },

    additiveChanges () {
      return this.changes.filter(c => !c.breaking)
    },

    shownAdditive () {
      return this.showAllAdditive
        ? this.additiveChanges
        : this.additiveChanges.slice(0, 5)
    },

    /* A new schema and a fork both publish as something new. An edit to
     * a published schema forks only when the classifier found a breaking
     * change. */
    forks () {
      return !!this.basedOn && this.breaking
    },

    newVersion () {
      return this.basedOn ? (this.breaking ? this.version + 1 : this.version) : this.version
    },

    verdict () {
      if (!this.basedOn)
        return `${this.name} publishes as version ${this.version}.`
      if (!this.changes.length)
        return `Nothing has changed since version ${this.version}.`
      if (this.breaking) {
        const lead = this.breakingChanges[0]
        const devices = this.configured.length
        const who = devices === 1 ? 'the 1 device' : `the ${devices} devices`
        return devices
          ? `${lead.summary} breaks ${who} using this schema, so this publishes as `
            + `version ${this.version + 1}.`
          : `${lead.summary}, so this publishes as version ${this.version + 1}.`
      }
      return `Version ${this.version} updates in place.`
    },

    verdictDetail () {
      if (!this.basedOn)
        return 'Nothing is using it yet, so there is nothing to break.'
      if (!this.changes.length)
        return 'Publishing would produce an identical schema.'
      if (this.breaking)
        return `Version ${this.version} stays exactly as it is. Nothing changes under a `
          + 'running machine until each device is moved to the new version.'
      const devices = this.configured.length
      if (!devices) return 'No devices are configured to use it yet.'
      return devices === 1
        ? 'The 1 device using it keeps running.'
        : `The ${devices} devices using it keep running.`
    },

    changeHeading () {
      if (!this.basedOn) return `${this.changes.length} changes`
      return `${this.changes.length} `
        + `${this.changes.length === 1 ? 'change' : 'changes'} since version ${this.version}`
    },

    actionLabel () {
      if (!this.basedOn) return 'Publish'
      return this.breaking ? `Publish version ${this.version + 1}` : 'Publish'
    },

    canPublish () {
      if (this.unresolved.length) return false
      if (this.basedOn && !this.changes.length) return false
      return true
    },

    blockingNames () {
      return this.unresolved.map(r => this.nameFor(r)).join(', ')
    },

    liveSet () {
      return new Set(this.publishing ?? [])
    },
  },

  methods: {
    nameFor (uuid) {
      const published = (this.sch.data ?? []).find(e => e.uuid === uuid)
      if (published)
        return `${published.schemaInformation?.name ?? published.name} `
          + `v${versionOf(published)}`
      const draft = (this.drafts.data ?? [])
        .find(e => e.draft?.schemaUuid === uuid)
      return draft ? draft.draft.name : uuid
    },

    draftFor (uuid) {
      return (this.drafts.data ?? [])
        .find(e => e.draft?.schemaUuid === uuid)?.uuid ?? null
    },

    isLive (device) {
      return this.liveSet.has(device.uuid)
    },

    /* The change list reads as subject then predicate, so the column of
     * names lines up and the eye scans down what changed rather than
     * re-reading the path each time. */
    subject (change) {
      if (change.kind === 'renamed') return change.from
      return change.path.join(' / ')
    },

    predicate (change) {
      const path = change.path.join(' / ')
      /* The summary already opens with the path; strip it so the two
       * columns do not repeat each other. */
      const stripped = change.summary
        .replace(new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:?\\s*`), '')
      if (change.kind === 'renamed') return `renamed to ${change.to}`
      return stripped || change.summary
    },

    async load () {
      this.loading = true
      try {
        const id = this.$route.params.id
        const entry = (this.drafts.data ?? []).find(e => e.uuid === id)
        if (!entry?.draft) throw new Error('That draft no longer exists.')

        this.draftUuid = id
        this.name = entry.draft.name
        this.version = entry.draft.version ?? 1
        this.schemaUuid = entry.draft.schemaUuid
        this.basedOn = entry.draft.basedOn ?? null
        this.derivedFrom = entry.draft.derivedFrom ?? null
        this.body = entry.draft.body

        const published = this.basedOn
          ? (this.sch.data ?? []).find(e => e.uuid === this.basedOn)
          : null

        const result = published?.schema
          ? classify(published.schema, this.body)
          : { changes: [], breaking: false }
        this.changes = result.changes
        this.breaking = result.breaking

        this.unresolved = unresolvedReferences(
          referencedSchemas(parse(this.body)), this.sch.data)

        await this.loadReach()
      } catch (err) {
        console.error('Failed to prepare publish', err)
        this.loadError = err.message
      } finally {
        this.loading = false
      }
    },

    async loadReach () {
      const reach = await blastRadius({
        client: this.s.client,
        schemaUuid: this.basedOn ?? this.schemaUuid,
        devices: this.dev.data,
        schemas: this.sch.data,
      })
      this.configured = reach.configured
      this.publishing = reach.publishing
      this.referencedBy = reach.referencedBy
    },

    back () {
      this.$router.push(`/schemas/draft/${this.draftUuid}`)
    },

    async publish () {
      this.working = true
      try {
        const published = this.basedOn
          ? (this.sch.data ?? []).find(e => e.uuid === this.basedOn)
          : null

        let target

        if (this.basedOn && !this.breaking) {
          target = await publishInPlace(this.s.client, {
            schemaUuid: this.basedOn,
            name: this.name,
            version: this.version,
            body: this.body,
            existing: published?.schemaInformation,
          })
        } else {
          const isNewVersion = !!this.basedOn
          const version = isNewVersion ? this.version + 1 : this.version
          let body = this.body

          if (isNewVersion) {
            /* A breaking edit forks. Mint the new identity here rather
             * than reusing the draft's, which may still be the one the
             * published schema occupies. */
            const doc = parse(this.body)
            doc.uuid = uuidv4()
            body = serialise(doc)
          }

          target = await publishNew(this.s.client, {
            name: this.name,
            version,
            body,
            replaces: isNewVersion ? this.basedOn : null,
            derivedFrom: this.derivedFrom,
          })
        }

        await deleteDraft(this.s.client, this.draftUuid)
        toast.success(`${this.name} published`)
        this.$router.push(`/schemas/${target}`)
      } catch (err) {
        console.error('Failed to publish schema', err)
        toast.error('Could not publish', { description: err.message })
      } finally {
        this.working = false
      }
    },
  },

  unmounted () {
    this.sch.stop()
    this.drafts.stop()
    this.dev.stop()
  },
}
</script>

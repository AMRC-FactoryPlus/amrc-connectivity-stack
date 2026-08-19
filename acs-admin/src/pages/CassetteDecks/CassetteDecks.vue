<template>
  <div class="flex h-full flex-col gap-4 p-4">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2 text-sm text-gray-500">
        <span>Wall clock</span>
        <span class="font-mono text-slate-950">{{ wallClockLabel }}</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="inline-flex items-center justify-center rounded-md bg-slate-100 p-1 text-gray-500">
          <button v-for="f in filters" :key="f"
            class="rounded-sm px-3 py-1.5 text-sm font-medium transition-all"
            :class="filter === f ? 'bg-white text-slate-950 shadow-sm' : ''"
            @click="filter = f">{{ f }}</button>
        </div>
        <Button size="sm" variant="outline" :disabled="!anyRunning" @click="engine.actions.stopAll">
          <i class="fa-solid fa-stop mr-1.5 text-[11px]"></i>Stop all
        </Button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 gap-4">
      <!-- Deck wall -->
      <div class="min-w-0 flex-1 overflow-y-auto">
        <EmptyState v-if="!engine.decks.value.length"
          title="No simulator devices yet"
          description="A deck appears here for every device on a connection that uses the Simulator driver. Create a device, pick the Simulator driver on its connection, and map its origin map."
          icon="tape"
          buttonText="New Device"
          buttonIcon="plus"
          @button-click="$router.push('/')"
        />
        <div v-else class="grid items-start gap-4"
          style="grid-template-columns: repeat(auto-fill, minmax(min(480px, 100%), 1fr));">
          <DeckCard v-for="deck in visibleDecks" :key="deck.uuid"
            :deck="deck"
            :rt="deck.rt"
            :cassette-meta="metaFor(deck.rt.cassette)"
            :now="now"
            :selected-cassette="selectedCassette"
            @play="d => engine.actions.play(d)"
            @pause="d => engine.actions.pause(d)"
            @stop="d => engine.actions.stop(d)"
            @eject="d => engine.actions.eject(d)"
            @seek="(d, ms) => engine.actions.seek(d, ms)"
            @rate="(d, r) => engine.actions.setRate(d, r)"
            @reload="d => engine.actions.reload(d)"
            @dismiss="d => engine.actions.dismiss(d)"
            @load="onLoad"
          />
        </div>
      </div>

      <!-- Library rail -->
      <div class="hidden w-[360px] shrink-0 lg:block">
        <CassetteLibrary
          :cassettes="libraryRows"
          :selected="selectedCassette"
          @select="v => selectedCassette = v"
          @upload="uploadOpen = true"
        />
      </div>
    </div>

    <UploadCassetteDialog
      :open="uploadOpen"
      @close="uploadOpen = false"
      @uploaded="onUploaded"
    />
  </div>
</template>

<script>
import { toast } from 'vue-sonner'

import { Button } from '@components/ui/button/index.js'
import EmptyState from '@components/EmptyState.vue'
import DeckCard from './DeckCard.vue'
import CassetteLibrary from './CassetteLibrary.vue'
import UploadCassetteDialog from './UploadCassetteDialog.vue'

import { serviceClientReady } from '@store/useServiceClientReady.js'
import { useDeviceStore } from '@store/useDeviceStore.js'
import { useConnectionStore } from '@store/useConnectionStore.js'
import { useNodeStore } from '@store/useNodeStore.js'
import { useSchemaStore } from '@store/useSchemaStore.js'
import { useCassetteObjectStore, useCassetteMetaStore } from '@store/useCassetteStore.js'
import { useCassetteDecks } from '@/composables/useCassetteDecks.js'

export default {
  components: { Button, EmptyState, DeckCard, CassetteLibrary, UploadCassetteDialog },

  data () {
    return {
      cassettes: useCassetteObjectStore(),
      meta: useCassetteMetaStore(),
      now: Date.now(),
      filter: 'All',
      filters: ['All', 'Playing', 'Idle', 'Empty'],
      selectedCassette: null,
      uploadOpen: false,
      clockTimer: null,
    }
  },

  created () {
    /* Deliberately not in data(): the engine holds rx subscriptions
     * and computed refs that must not be deep-proxied. Its inner refs
     * are reactive, so the template still tracks them. */
    this.engine = useCassetteDecks()
  },

  computed: {
    wallClockLabel () {
      return new Date(this.now).toLocaleTimeString('en-GB')
    },
    anyRunning () {
      return this.engine.decks.value
        .some(d => ['PLAYING', 'PAUSED'].includes(d.rt.status))
    },
    visibleDecks () {
      const decks = this.engine.decks.value
      switch (this.filter) {
      case 'Playing': return decks.filter(d => d.rt.status === 'PLAYING')
      case 'Idle': return decks.filter(d =>
        ['LOADED', 'PAUSED', 'ENDED'].includes(d.rt.status))
      case 'Empty': return decks.filter(d =>
        ['EMPTY', 'LOADING'].includes(d.rt.status))
      default: return decks
      }
    },
    libraryRows () {
      return this.cassettes.data.map(c => ({
        uuid: c.uuid,
        name: c.name,
        meta: this.meta.meta[c.uuid] ?? null,
        loadedIn: this.engine.decks.value
          .filter(d => d.rt.cassette === c.uuid)
          .map(d => d.name),
      }))
    },
  },

  async mounted () {
    this.clockTimer = setInterval(() => { this.now = Date.now() }, 1000)
    await serviceClientReady()

    await Promise.all([
      useDeviceStore().start(),
      useConnectionStore().start(),
      useNodeStore().start(),
      useSchemaStore().start(),
      this.cassettes.start(),
    ])
    await this.engine.start()

    /* Attach a live subscription whenever a new deck appears, and
     * fetch metadata for every cassette we can see. */
    this.$watch(() => this.engine.decks.value, decks => {
      decks.forEach(d => this.engine.watchDeck(d))
      decks.forEach(d => d.rt.cassette && this.meta.fetchMeta(d.rt.cassette))
    }, { immediate: true })
    this.$watch(() => this.cassettes.data, list => {
      list.forEach(c => this.meta.fetchMeta(c.uuid))
    }, { immediate: true })
  },

  unmounted () {
    clearInterval(this.clockTimer)
    this.engine.stop()
  },

  methods: {
    metaFor (uuid) {
      if (!uuid) return null
      const m = this.meta.meta[uuid]
      if (!m) this.meta.fetchMeta(uuid)
      return m ?? null
    },
    async onLoad (deck, cassetteUuid, force = false) {
      const uuid = cassetteUuid ?? this.selectedCassette
      if (!uuid) return
      this.selectedCassette = null

      /* A cassette records which schema it was made for. Loading it
       * onto a device with a different schema is allowed (addresses
       * the origin map does not know are silently ignored), but it is
       * almost always a mistake, so say so first. */
      const meta = this.meta.meta[uuid]
      if (!force && meta?.deviceSchema && deck.schemaName
          && !this.schemasMatch(meta.deviceSchema, deck.schemaName)) {
        deck.rt.strip = {
          kind: 'info',
          text: `This recording was made for a "${meta.deviceSchema}" device; `
            + `${deck.name} uses the "${deck.schemaName}" schema. Channels the `
            + 'origin map does not know are silently ignored.',
          action: 'load-anyway',
          cassette: uuid,
        }
        return
      }

      await this.engine.actions.load(deck, uuid)
      this.meta.fetchMeta(uuid)
    },
    schemasMatch (cassetteSchema, deviceSchema) {
      const a = String(cassetteSchema).toLowerCase()
      const b = String(deviceSchema).toLowerCase()
      return a === b || a.includes(b) || b.includes(a)
    },
    onUploaded (uuid) {
      this.meta.fetchMeta(uuid)
      toast.info('Drag the new cassette onto a deck to load it')
    },
  },
}
</script>

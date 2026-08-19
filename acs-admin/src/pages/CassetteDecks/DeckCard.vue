<template>
  <div
    class="flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm transition-colors"
    :class="rt.dragOver ? 'border-slate-900 ring-2 ring-slate-900/20' : 'border-slate-200'"
    @dragover.prevent="rt.dragOver = true"
    @dragleave="rt.dragOver = false"
    @drop.prevent="onDrop"
  >
    <!-- Identity + transport state -->
    <div class="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
      <div class="flex min-w-0 flex-col gap-1">
        <div class="flex items-center gap-2">
          <span class="h-2 w-2 shrink-0 rounded-full"
            :class="rt.online ? 'bg-green-500'
              : rt.seen ? 'bg-red-400' : 'bg-slate-300 animate-pulse'"></span>
          <div class="truncate text-base font-semibold tracking-tight">{{ deck.name }}</div>
          <span class="text-[10px] font-semibold uppercase tracking-wide"
            :class="rt.online ? 'text-green-600' : 'text-slate-400'">
            {{ rt.online ? 'Online' : rt.seen ? 'Offline' : 'Waiting for device' }}
          </span>
        </div>
        <div class="pl-4 font-mono text-xs text-gray-500">{{ addressLabel }}</div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span class="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-bold tracking-wide"
          :class="pillClass">
          <i v-if="rt.status === 'PLAYING'" class="fa-solid fa-play text-[8px]"></i>
          <i v-else-if="rt.status === 'LOADING'" class="fa-solid fa-circle-notch animate-spin text-[8px]"></i>
          {{ rt.status }}
        </span>
        <span v-if="showRateChip"
          class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs font-semibold">
          {{ rt.rateActual || rt.selectedRate }}&times;
        </span>
      </div>
    </div>

    <!-- Cassette window / empty slot -->
    <div class="mx-5">
      <div v-if="cassetteLoaded"
        class="flex items-center gap-4 rounded-md border border-slate-200 bg-gray-50 px-3.5 py-3">
        <div class="flex items-center gap-1" aria-hidden="true">
          <div class="reel" :class="{ 'reel--spin': rt.status === 'PLAYING' }"><div></div></div>
          <div class="h-0.5 w-5 bg-slate-300"></div>
          <div class="reel" :class="{ 'reel--spin': rt.status === 'PLAYING' }"><div></div></div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate font-mono text-[13px] font-medium">{{ cassetteName }}</div>
          <div class="mt-0.5 text-xs text-gray-500">{{ cassetteMetaLine }}</div>
        </div>
      </div>
      <div v-else
        class="flex items-center gap-4 rounded-md border border-dashed px-3.5 py-3"
        :class="[
          rt.dragOver ? 'border-slate-900 bg-slate-50' : 'border-slate-300',
          selectedCassette && controllable ? 'cursor-pointer hover:border-slate-900 hover:bg-slate-50' : '',
        ]"
        @click="onSlotClick">
        <i class="fa-solid fa-inbox text-slate-300"></i>
        <div>
          <div class="text-[13px] font-medium"
            :class="rt.dragOver || selectedCassette ? 'text-slate-900' : 'text-slate-500'">
            {{ rt.dragOver ? 'Release to load'
              : selectedCassette ? 'Load selected' : 'Empty slot' }}
          </div>
          <div class="mt-0.5 text-xs text-gray-500">
            Drag a cassette here, or select one in the library.
          </div>
        </div>
      </div>
    </div>

    <!-- Position scrubber -->
    <div class="px-5 pt-3.5">
      <div
        ref="bar"
        class="relative h-7 overflow-hidden rounded bg-slate-100"
        :class="scrubbable ? 'cursor-pointer' : 'opacity-50'"
        @pointerdown="scrubStart"
      >
        <div class="absolute inset-y-0 left-0"
          :class="scrubbing && scrubBackwards ? 'bg-amber-500' : 'bg-green-500'"
          :style="{ width: fillPercent + '%' }"></div>
        <div class="absolute inset-0"
          style="background: repeating-linear-gradient(90deg, rgba(255,255,255,0) 0 6px, #fff 6px 8px);"></div>
        <div class="absolute -top-0.5 -bottom-0.5 w-0.5 bg-slate-950"
          :style="{ left: fillPercent + '%' }"></div>
      </div>
      <div class="mt-1.5 flex items-center justify-between font-mono text-xs text-gray-500">
        <span class="text-slate-950">{{ positionLabel }}</span>
        <span v-if="scrubbing && scrubBackwards" class="font-medium text-amber-600">
          Rewind to {{ mmss(scrubPosition) }} &middot; rewrites history
        </span>
        <span>{{ durationLabel }}</span>
      </div>
    </div>

    <!-- Virtual clock -->
    <div class="mx-5 mt-3.5 flex items-center justify-between gap-4 rounded-md border border-slate-200 px-3.5 py-3">
      <div>
        <div class="text-[11px] font-medium uppercase tracking-wide text-gray-500">Virtual clock</div>
        <div class="mt-0.5 font-mono text-[28px] font-semibold leading-none tracking-tight">
          {{ virtualClockLabel }}
        </div>
      </div>
      <div class="text-right">
        <template v-if="driftMs > 1500">
          <div class="inline-flex items-center gap-1.5 font-mono text-base font-bold text-amber-500">
            <i class="fa-solid fa-arrow-trend-up text-xs"></i>+{{ drift(driftMs) }}
          </div>
          <div class="mt-0.5 text-xs text-gray-500">ahead of the wall clock</div>
        </template>
        <div v-else class="text-xs text-gray-500">in step with the wall clock</div>
      </div>
    </div>

    <!-- Transport + rate -->
    <div class="flex flex-wrap items-center justify-between gap-4 px-5 pb-4 pt-3.5">
      <div class="flex items-center gap-1.5">
        <Button v-if="rt.status === 'ENDED'" size="sm" :disabled="!controllable"
          @click="$emit('play', deck)">
          <i class="fa-solid fa-rotate-left mr-1.5 text-[11px]"></i>Play again
        </Button>
        <Button v-else size="sm" :disabled="!controllable || !cassetteLoaded || rt.status === 'PLAYING'"
          @click="$emit('play', deck)">
          <i class="fa-solid fa-play mr-1.5 text-[11px]"></i>Play
        </Button>
        <Button size="sm" variant="outline" :disabled="!controllable || rt.status !== 'PLAYING'"
          @click="$emit('pause', deck)">
          <i class="fa-solid fa-pause mr-1.5 text-[11px]"></i>Pause
        </Button>
        <Button size="sm" variant="outline"
          :disabled="!controllable || !['PLAYING', 'PAUSED', 'ENDED'].includes(rt.status)"
          @click="$emit('stop', deck)">
          <i class="fa-solid fa-stop mr-1.5 text-[11px]"></i>Stop
        </Button>
        <Button size="sm" variant="ghost" :disabled="!controllable || !cassetteLoaded"
          @click="$emit('eject', deck)">
          <i class="fa-solid fa-eject mr-1.5 text-[11px]"></i>Eject
        </Button>
        <Button size="sm" :variant="rt.loopSelected ? 'secondary' : 'ghost'"
          :disabled="!controllable"
          :title="rt.loopSelected
            ? 'Looping: the cassette replays end to end with monotonic stamps'
            : 'Loop the cassette on the next Play'"
          @click="rt.loopSelected = !rt.loopSelected">
          <i class="fa-solid fa-repeat text-[11px]"
            :class="rt.loopSelected ? 'text-slate-950' : ''"></i>
        </Button>
      </div>
      <div class="flex items-center overflow-hidden rounded-md border border-slate-200">
        <button v-for="r in rates" :key="r"
          class="h-7 min-w-[34px] border-0 border-l border-slate-200 font-mono text-xs first:border-l-0"
          :class="activeRate === r
            ? 'bg-slate-900 font-semibold text-white'
            : 'bg-white text-slate-600 hover:bg-slate-50'"
          :disabled="!controllable"
          @click="$emit('rate', deck, r)"
        >{{ r }}</button>
      </div>
    </div>

    <!-- Shared-connection warning: one connection = one driver = one
         player, so decks on a shared connection mirror each other and
         fight over commands. Not dismissable; fix the topology. -->
    <div v-if="deck.sharedWith?.length" class="border-t border-slate-200 bg-amber-50">
      <div class="flex items-start gap-2.5 px-4 py-3">
        <i class="fa-solid fa-triangle-exclamation mt-0.5 text-amber-500"></i>
        <div class="min-w-0 flex-1 text-[13px] text-amber-800">
          This deck shares one player with {{ deck.sharedWith.join(', ') }}.
          Devices on the same connection receive identical data and race
          for the transport commands. Give each simulated machine its own
          connection using the Simulator driver.
        </div>
      </div>
    </div>

    <!-- Strip -->
    <div v-if="rt.strip" class="border-t border-slate-200"
      :class="rt.strip.kind === 'error' ? 'bg-white' : 'bg-gray-50'">
      <div class="flex items-start gap-2.5 px-4 py-3">
        <i class="mt-0.5"
          :class="stripIcon"></i>
        <div class="min-w-0 flex-1">
          <div v-if="rt.strip.title" class="text-sm font-medium text-red-500">{{ rt.strip.title }}</div>
          <div class="text-[13px]"
            :class="rt.strip.kind === 'error' ? 'text-red-800' : 'text-slate-600'">
            {{ rt.strip.text }}
          </div>
        </div>
        <Button v-if="rt.strip.action === 'reload'" size="xs" variant="outline"
          @click="$emit('reload', deck)">Reload</Button>
        <template v-else-if="rt.strip.action === 'load-anyway'">
          <Button size="xs" variant="outline"
            @click="$emit('load', deck, rt.strip.cassette, true)">Load anyway</Button>
          <Button size="xs" variant="ghost"
            @click="$emit('dismiss', deck)">Cancel</Button>
        </template>
        <Button v-else size="xs" variant="ghost"
          @click="$emit('dismiss', deck)">Dismiss</Button>
      </div>
    </div>
  </div>
</template>

<script>
import { Button } from '@components/ui/button/index.js'
import { DECK_RATES } from '@/lib/edge-sim-uuids.js'
import { mmss, drift } from '@/composables/useCassetteDecks.js'

export default {
  components: { Button },
  props: {
    deck: { type: Object, required: true },
    /* Reactive runtime state for this deck */
    rt: { type: Object, required: true },
    /* Metadata for the loaded cassette, if known */
    cassetteMeta: { type: Object, default: null },
    /* Wall-clock tick shared by the page so all decks agree */
    now: { type: Number, required: true },
    /* Cassette selected in the library, offered as click-to-load */
    selectedCassette: { type: String, default: null },
  },
  emits: ['play', 'pause', 'stop', 'eject', 'seek', 'rate', 'reload', 'dismiss', 'load'],
  data () {
    return {
      rates: DECK_RATES,
      scrubbing: false,
      scrubPosition: 0,
    }
  },
  computed: {
    addressLabel () {
      return this.deck.address
        ? this.deck.address.split('/').join(' / ')
        : 'No Sparkplug address'
    },
    cassetteLoaded () {
      return !!this.rt.cassette
        && !['EMPTY', 'LOADING'].includes(this.rt.status)
    },
    cassetteName () {
      return this.cassetteMeta?.name ?? this.rt.cassette ?? ''
    },
    cassetteMetaLine () {
      const m = this.cassetteMeta
      if (!m) return 'Recording details unavailable'
      return `${mmss(m.duration_ms)} · ${m.channels} channels · ${m.source}`
    },
    durationMs () {
      return this.cassetteMeta?.duration_ms ?? 0
    },
    controllable () {
      return this.rt.online && this.deck.address
    },
    scrubbable () {
      return this.controllable && this.cassetteLoaded && this.durationMs > 0
    },
    fillPercent () {
      if (!this.durationMs) return 0
      const pos = this.scrubbing ? this.scrubPosition : this.rt.position
      return Math.min(100, Math.max(0, (pos / this.durationMs) * 100))
    },
    scrubBackwards () {
      return this.scrubPosition < this.rt.position
    },
    positionLabel () {
      return mmss(this.scrubbing ? this.scrubPosition : this.rt.position)
    },
    durationLabel () {
      return this.durationMs ? mmss(this.durationMs) : '--:--'
    },
    showRateChip () {
      const r = this.rt.status === 'PLAYING' ? this.rt.rateActual : this.rt.selectedRate
      return r > 1
    },
    activeRate () {
      return this.rt.status === 'PLAYING' && this.rt.rateActual
        ? this.rt.rateActual : this.rt.selectedRate
    },
    virtualNowMs () {
      if (this.rt.playStartWall == null) return null
      return this.rt.playStartWall + this.rt.position
    },
    virtualClockLabel () {
      const t = this.virtualNowMs ?? this.now
      return new Date(t).toLocaleTimeString('en-GB')
    },
    driftMs () {
      if (this.virtualNowMs == null) return 0
      return this.virtualNowMs - this.now
    },
    pillClass () {
      switch (this.rt.status) {
      case 'PLAYING': return 'bg-green-600 text-white'
      case 'PAUSED': return 'bg-amber-500 text-white'
      case 'ENDED': return 'bg-slate-900 text-white'
      case 'LOADING': return 'bg-slate-200 text-slate-700'
      case 'LOADED': return 'bg-slate-200 text-slate-900'
      default: return 'bg-gray-100 text-gray-500'
      }
    },
    stripIcon () {
      if (this.rt.strip?.kind === 'error') return 'fa-solid fa-triangle-exclamation text-red-500'
      if (this.rt.strip?.kind === 'offline') return 'fa-solid fa-plug-circle-xmark text-slate-600'
      return 'fa-solid fa-circle-info text-slate-600'
    },
  },
  methods: {
    mmss,
    drift,
    onDrop (e) {
      this.rt.dragOver = false
      const uuid = e.dataTransfer?.getData('application/x-cassette')
      if (uuid) this.$emit('load', this.deck, uuid)
    },
    onSlotClick () {
      if (this.selectedCassette && this.controllable)
        this.$emit('load', this.deck, this.selectedCassette)
    },
    scrubStart (e) {
      if (!this.scrubbable) return
      this.scrubbing = true
      this.scrubPosition = this.posFromEvent(e)
      const move = ev => { this.scrubPosition = this.posFromEvent(ev) }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        this.scrubbing = false
        this.$emit('seek', this.deck, this.scrubPosition)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    posFromEvent (e) {
      const rect = this.$refs.bar.getBoundingClientRect()
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      return frac * this.durationMs
    },
  },
}
</script>

<style scoped>
.reel {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 2px solid #cbd5e1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.reel > div {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: #94a3b8;
}
.reel--spin {
  border-style: dashed;
  animation: deck-reel 1.6s linear infinite;
}
@keyframes deck-reel {
  to { transform: rotate(360deg); }
}
</style>

<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -
  - Hosts a driver-supplied configuration UI.
  -
  - The document comes from the driver definition in ConfigDB, which means it
  - is third-party content running in the operator's browser. It is rendered
  - in an iframe with `sandbox="allow-scripts"` and deliberately WITHOUT
  - `allow-same-origin`, so the browser gives it an opaque origin: it cannot
  - reach this document, our cookies, our storage, or the operator's session.
  -
  - Everything it sends back is validated by lib/driver-ui/contract.js before
  - it goes anywhere near the metric model.
  -->

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 text-gray-500">
        <i class="fa-solid fa-puzzle-piece text-xs"></i>
        <div class="text-xs font-bold uppercase tracking-wide">
          Supplied by the driver
        </div>
      </div>
      <Button
          variant="outline" size="plain"
          class="px-2 text-gray-500 text-sm"
          @click="$emit('use-standard')"
      >
        Use standard fields
      </Button>
    </div>

    <div v-if="problems.length"
        class="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
    >
      <div class="font-semibold mb-1">The driver's interface proposed something invalid</div>
      <ul class="list-disc pl-5">
        <li v-for="p in problems" :key="p">{{ p }}</li>
      </ul>
    </div>

    <iframe
        ref="frame"
        :src="hostPage"
        sandbox="allow-scripts"
        :style="{ height: `${height}px` }"
        class="w-full rounded border border-gray-300 bg-white"
        title="Driver-supplied metric configuration"
    ></iframe>
  </div>
</template>

<script>
import { Button } from '@/components/ui/button'

import { HANDSHAKE_TIMEOUT_MS, HOST_PAGE, CONTRACT_VERSION } from '@/lib/driver-ui/contract.js'
import { create_host } from '@/lib/driver-ui/host.js'

export default {
  name: 'DriverCustomUI',

  components: { Button },

  /* Edge Scout access, provided by the origin map editor. A version 2
   * document reads discovered addresses and opens the picker through
   * it. Null where the editor has no Addresses panel. */
  inject: {
    scout: { from: 'driverUiScout', default: null },
  },

  props: {
    /** The HTML document from the driver definition. */
    document:     { type: String,  required: true },
    /** The contract version the document was written against. */
    version:      { type: Number,  default: CONTRACT_VERSION },
    /** Driver connection configuration. Secrets are redacted before it
     * crosses into the frame; see contract.js. */
    config:       { type: Object,  default: () => ({}) },
    /** The driver's connection schema, used to locate those secrets. */
    configSchema: { type: Object,  default: null },
    /** Current values of the metric being edited. */
    metric:       { type: Object,  default: () => ({}) },
    /** Sparkplug type names this metric is permitted to take. */
    allowedTypes: { type: Array,   default: () => [] },
    /** DriverDef `scout.share_samples`: let the document see samples. */
    shareSamples: { type: Boolean, default: false },
  },

  emits: ['propose', 'use-standard', 'unavailable'],

  data () {
    return {
      hostPage: HOST_PAGE,
      /* Starting height is a guess; the document tells us its real height
       * over the contract as soon as it has laid out. */
      height:   260,
      ready:    false,
      problems: [],
      timer:    null,
    }
  },

  computed: {
    /* The scan summary, as a string so the watcher only fires when it
     * actually changes. */
    scoutKey () {
      return JSON.stringify(this.scout?.summary() ?? null)
    },
  },

  watch: {
    scoutKey () {
      if (this.ready && this.scout) this.host?.scout_changed(this.scout.summary())
    },
  },

  created () {
    this.host = create_host({
      post:     msg => this.post(msg),
      document: this.document,
      version:  this.version,
      scout:    this.scout,
      share_samples: this.shareSamples,
      init_values: () => ({
        config:        this.config,
        config_schema: this.configSchema,
        metric:        this.metric,
        allowed_types: this.allowedTypes,
      }),
      on: {
        /* The driver's own document is now running and listening. The
         * host sends init only now, because sending earlier would race
         * the document attaching its listener. */
        ready: () => {
          this.ready = true
          this.clear_timer()
        },
        /* The shell could not write the document at all. No point waiting
         * out the handshake timeout. */
        failed: reason => {
          this.clear_timer()
          this.$emit('unavailable', reason)
        },
        resize: h => { this.height = h },
        problems: list => { this.problems = list },
        /* Apply whatever was valid. Discarding good values because a
         * sibling field was malformed would be its own surprise. */
        propose: values => this.$emit('propose', values),
      },
    })
  },

  mounted () {
    this.listener = e => this.on_message(e)
    window.addEventListener('message', this.listener)

    /* Covers the whole exchange: shell load, document delivery, and the
     * document announcing itself. A driver document that never speaks must
     * not leave the operator staring at an empty panel. */
    this.timer = setTimeout(() => {
      if (!this.ready) this.$emit('unavailable', 'no-handshake')
    }, HANDSHAKE_TIMEOUT_MS)
  },

  beforeUnmount () {
    window.removeEventListener('message', this.listener)
    this.clear_timer()
  },

  methods: {
    clear_timer () {
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
    },

    /* The frame has an opaque origin, so '*' is the only target that can
     * reach it. Safe because nothing we send is secret: the config is
     * redacted by the contract before it goes anywhere near the frame. */
    post (message) {
      this.$refs.frame?.contentWindow?.postMessage(message, '*')
    },

    on_message (event) {
      const frame = this.$refs.frame
      /* Only listen to our own frame. The console shares a window with
       * other things that post messages. */
      if (!frame || event.source !== frame.contentWindow) return
      this.host.handle(event.data)
    },
  },
}
</script>

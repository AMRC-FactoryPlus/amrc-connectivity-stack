<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->
<template>
  <Skeleton v-if="loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <div v-else>
    <div class="flex justify-between items-center mb-4">
      <div>
        <RouterLink to="./">{{application?.name}}</RouterLink> - {{object?.name}}
      </div>
      <div class="flex items-center gap-4">
        <Button variant="outline" @click="toggleYaml">
          <Checkbox :model-value="settings.useYaml" @click="toggleYaml" />
          <div class="ml-2">Edit as Yaml</div>
        </Button>
        <Button :disabled="v$.$invalid" @click="formSubmit">Save</Button>
      </div>
    </div>
    <MonacoEditor
        v-if="v$.code.$model !== null && v$.code.$model !== undefined"
        class="editor h-[40em] w-[95%] border b-slate-300"
        :language="format"
        :value="v$.code.$model"
        @change="editorChange"
        :options="{
          lineNumbers: true,
          tabCompletion: 'on',
          glyphMargin: true
        }"
      />
  </div>
</template>

<script>
import {Skeleton} from '@components/ui/skeleton'
import {columns} from './TableData/applicationListColumns.ts'
import {Card} from "@components/ui/card/index.js";
import {useServiceClientStore} from "@store/serviceClientStore.js";
import {useRoute, useRouter} from "vue-router";
import {serviceClientReady} from "@store/useServiceClientReady.js";
import {useApplicationStore} from "@store/useApplicationStore.js";
import {useObjectStore} from "@store/useObjectStore.js";
import MonacoEditor from "vue-monaco";
import {h} from 'vue'
import yaml from "yaml";
import {Button} from "@components/ui/button/index.js";
import {Checkbox} from "@components/ui/checkbox/index.js";
import useVuelidate from "@vuelidate/core";
import {required} from "@vuelidate/validators";
import {toast} from "vue-sonner";
import {useDialog} from '@/composables/useDialog';
import {useUserSettingsStore} from "@store/useUserSettingsStore.js";

MonacoEditor.render = () => h('div')

export default {
  emits: ['rowClick'],

  setup () {
    return {
      v$: useVuelidate(),
      s: useServiceClientStore(),
      app: useApplicationStore(),
      obj: useObjectStore(),
      settings: useUserSettingsStore(),
      columns: columns,
      router: useRouter(),
      route: useRoute(),
    }
  },

  data() {
    return {
      format: this.settings.useYaml ? 'yaml' : 'json',
      data: [], // Stores the raw JavaScript Object to be transferred to/from the backend
      incomingBufferJson: null, // Stores the incoming formatted JSON string the server is sending to us
      code: null, // Stores the formatted JSON string that is being edited locally
      loading: false,
      rxsub: null,
      formats: {
        json: {
          parse: JSON.parse,
          stringify: (o) => JSON.stringify(o, null, 2),
        },
        yaml: {
          parse: yaml.parse,
          stringify: (o) => yaml.stringify(o, null, {
            sortMapEntries:     true,
            blockQuote:         "literal",
            indent:             2,
          }),
        }
      }
    }
  },

  components: {
    Checkbox,
    Button,
    Card,
    Skeleton,
    MonacoEditor,
  },

  computed: {
    application () {
      return this.app.data.find(a => a.uuid === this.route.params.application)
    },
    object () {
      return this.obj.data.find(o => o.uuid === this.route.params.object)
    },
  },

  methods: {
    startObjectSync: async function () {
      this.loading = true;

      // Wait until the store is ready before attempting to fetch data
      await serviceClientReady();

      const cdb = this.s.client.ConfigDB;

      const app = this.route.params.application
      const obj = this.route.params.object

      const object = cdb.watch_config(app, obj)

      this.rxsub = object.subscribe(this.syncMessageReceived);
    },
    stopObjectSync: function() {
      this.rxsub?.unsubscribe();
      this.rxsub = null;
    },
    syncMessageReceived: function (message) {
      console.debug("CONFIG UPDATE: %o", message);
      this.data = message
      this.incomingBufferJson = this.formats.json.stringify(message)
      // If the code has been changed and the server is sending something different, ask the user what to do
      if (this.v$.$dirty) {
        const codeJson = this.settings.useYaml ? this.formats.json.stringify(this.formats.yaml.parse(this.code)) : this.code
        if (this.incomingBufferJson !== codeJson) {
          useDialog({
            title: 'Update From Remote?',
            message: `The remote config entry for this object has changed. Do you wish to overwrite your local changes with the remote version?`,
            confirmText: 'Use Remote',
            onConfirm: () => {
              this.code = this.settings.useYaml ? this.formats.yaml.stringify(this.formats.json.parse(this.incomingBufferJson)) : this.incomingBufferJson
              this.v$.$reset()
            }
          });
        }
      } else {
        // The form hasn't been changed
        // We'll set the local string as this might be the first pass, or there are remote changes before anything has changed locally
        this.code = this.settings.useYaml ? this.formats.yaml.stringify(this.formats.json.parse(this.incomingBufferJson)) : this.incomingBufferJson
        if (!this.loading) {
          // Only notify if this isn't the first load
          toast.success(`Config entry has been updated from the remote`)
        }
      }
      this.loading = false

    },
    async formSubmit () {
      const isFormCorrect = await this.v$.$validate()
      if (!isFormCorrect) return

      const cdb = this.s.client.ConfigDB;
      try {
        await cdb.put_config(this.application.uuid, this.object.uuid, this.parse(this.code))
        toast.success(`Config entry for ${this.object.name} has been updated`)
        this.v$.$reset()
      } catch (err) {
        toast.error(`Unable to update ${this.object.name}`)
        console.error(err)
      }
    },
    editorChange (e) {
      if (typeof e === 'string' || e instanceof String) {
        this.v$.code.$model = e
      }
    },
    toggleYaml() {
      this.settings.setUseYaml(!this.settings.useYaml)
      const obj = this.parse(this.code)
      this.format = this.settings.useYaml ? 'yaml' : 'json'
      this.code = this.stringify(obj)
    },
    parse(s) {
      return this.formats[this.format].parse(s)
    },
    stringify(o) {
      return this.formats[this.format].stringify(o)
    },
  },

  async mounted () {
    this.obj.start()
    this.app.start()
    this.startObjectSync()
  },

  unmounted () {
    this.app.stop()
    this.obj.stop()
    this.stopObjectSync()
  },

  beforeRouteLeave (to, from , next) {
    if (this.v$.$dirty) {
      useDialog({
        title: 'Leave Without Saving?',
        message: `You have unsaved changes to this config entry, if you leave you will lose your changes.`,
        confirmText: 'Leave',
        onConfirm: () => {
          next()
        },
        onCancel: () => {
          next(false)
        }
      });
    } else {
      next()
    }
  },

  validations: {
    code: { required },
  },
}
</script>
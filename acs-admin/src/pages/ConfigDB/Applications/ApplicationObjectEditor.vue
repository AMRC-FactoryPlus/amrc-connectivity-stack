<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->
<template>
  <ConfigDBContainer padding="p-0">
    <Skeleton v-if="loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
    <div v-else class="flex-1 h-full">
      <MonacoEditor
          v-if="v$.code.$model !== null && v$.code.$model !== undefined"
          class="editor h-full"
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

    <template #header>
      <div class="flex justify-between items-center mr-3">
        <div class="flex items-center gap-2">
          <Button variant="destructive" :disabled="!v$.$dirty || v$.$invalid" @click="formSubmit" class="shrink-0">
            <div class="flex items-center justify-center gap-1">
              <span>Save Changes</span>
              <i v-if="!saveLoading" class="fa-sharp fa-solid fa-save ml-2"></i>
              <i v-else class="fa-sharp fa-solid fa-circle-notch fa-spin ml-2"></i>
            </div>
          </Button>
          <Button variant="outline" @click="toggleYaml">
            <Checkbox :model-value="settings.useYaml" @click="toggleYaml" />
            <div class="ml-2">Edit as Yaml</div>
          </Button>
        </div>
      </div>
    </template>

    <template #sidebar>
      <!-- Sidebar -->
      <div v-if="object" class="w-96 border-l border-border -mr-4 hidden xl:block overflow-y-auto">
        <div class="flex items-center justify-between gap-2 w-full p-4 border-b">
          <div class="flex items-center justify-center gap-2">
            <i class="fa-fw fa-solid fa-circle-nodes"></i>
            <div class="font-semibold text-xl">{{object.name}}</div>
          </div>
          <Button title="Go to object" size="xs" class="flex items-center justify-center gap-2 mr-2" @click="goToObject" variant="ghost">
            <i class="fa-solid fa-external-link text-gray-400"></i>
          </Button>
        </div>
        <div class="space-y-4 p-4">
          <SidebarDetail
              icon="key"
              label="Object UUID"
              :value="object?.uuid ?? ''"
          />
          <SidebarDetail
              icon="tag"
              label="Class"
              :value="object?.class?.name ?? ''"
          />
          <SidebarDetail
              icon="key"
              label="Class UUID"
              :value="object?.class?.uuid ?? ''"
          />
          <SidebarDetail
              icon="ranking-star"
              label="Rank"
              :value="object?.rank?.toString() ?? ''"
          />
        </div>

        <div class="font-semibold text-lg p-4 border-b">Application</div>
        <div class="space-y-4 p-4">
          <SidebarDetail
              icon="puzzle-piece"
              label="Application"
              :value="application?.name ?? ''"
          />
          <SidebarDetail
              icon="key"
              label="Application UUID"
              :value="application?.uuid ?? ''"
          />
        </div>
      </div>
    </template>
  </ConfigDBContainer>
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
import ConfigDBContainer from '@components/Containers/ConfigDBContainer.vue'
import SidebarDetail from '@components/SidebarDetail.vue'

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
      saveLoading: false,
      rxsub: null,
      ignoreRouteChange: false, // Flag to prevent route watcher from triggering during cancellation
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
    ConfigDBContainer,
    Checkbox,
    Button,
    Card,
    Skeleton,
    MonacoEditor,
    SidebarDetail,
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

    goToObject() {
      this.router.push({ path: `/configdb/objects/${this.route.params.object}` })
    },

    startObjectSync: async function () {
      this.loading = true;

      // Reset form state for new object
      this.data = [];
      this.incomingBufferJson = null;
      this.code = null;

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
      this.saveLoading = true

      const cdb = this.s.client.ConfigDB;
      try {
        await cdb.put_config(this.application.uuid, this.object.uuid, this.parse(this.code))
        toast.success(`Config entry for ${this.object.name} has been updated`)
        this.v$.$reset()
        this.saveLoading = false
      } catch (err) {
        toast.error(`Unable to update ${this.object.name}`)
        console.error(err)
        this.saveLoading = false
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

  watch: {
    '$route.params.object': {
      handler: function(newVal, oldVal) {
        // Skip if we're handling a cancellation or if values are the same
        if (this.ignoreRouteChange || newVal === oldVal) {
          this.ignoreRouteChange = false;
          return;
        }

        // Check for dirty form before changing
        if (this.v$.$dirty) {
          useDialog({
            title: 'Leave Without Saving?',
            message: `You have unsaved changes to this config entry, if you leave you will lose your changes.`,
            confirmText: 'Leave',
            onConfirm: () => {
              this.stopObjectSync();
              this.startObjectSync();
              this.v$.$reset();
            },
            onCancel: () => {
              // Set flag to prevent watcher from triggering again
              this.ignoreRouteChange = true;

              // Stay on the current object by navigating back
              this.$router.replace({
                name: this.$route.name,
                params: { ...this.$route.params, object: oldVal }
              });
            }
          });
        } else {
          // No unsaved changes, just reload
          this.stopObjectSync();
          this.startObjectSync();
        }
      }
    },
    '$route.params.application': {
      handler: function(newVal, oldVal) {
        // Skip if we're handling a cancellation or if values are the same
        if (this.ignoreRouteChange || newVal === oldVal) {
          this.ignoreRouteChange = false;
          return;
        }

        // Check for dirty form before changing
        if (this.v$.$dirty) {
          useDialog({
            title: 'Leave Without Saving?',
            message: `You have unsaved changes to this config entry, if you leave you will lose your changes.`,
            confirmText: 'Leave',
            onConfirm: () => {
              this.stopObjectSync();
              this.startObjectSync();
              this.v$.$reset();
            },
            onCancel: () => {
              // Set flag to prevent watcher from triggering again
              this.ignoreRouteChange = true;

              // Stay on the current application by navigating back
              this.$router.replace({
                name: this.$route.name,
                params: { ...this.$route.params, application: oldVal }
              });
            }
          });
        } else {
          // No unsaved changes, just reload
          this.stopObjectSync();
          this.startObjectSync();
        }
      }
    }
  },

  beforeRouteLeave (to, from, next) {
    // If we're handling a cancellation, allow the navigation
    if (this.ignoreRouteChange) {
      this.ignoreRouteChange = false;
      next();
      return;
    }

    if (this.v$.$dirty) {
      useDialog({
        title: 'Leave Without Saving?',
        message: `You have unsaved changes to this config entry, if you leave you will lose your changes.`,
        confirmText: 'Leave',
        onConfirm: () => {
          next();
        },
        onCancel: () => {
          next(false);
        }
      });
    } else {
      next();
    }
  },

  validations: {
    code: { required },
  },
}
</script>
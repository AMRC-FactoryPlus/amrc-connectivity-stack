<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->
<template>
  <Skeleton v-if="loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <div v-else>
    <div>
      <RouterLink to="./">{{application?.name}}</RouterLink> - {{object?.name}}
    </div>
    <MonacoEditor v-if="code" class="editor h-[40em] w-full" v-model="code" language="javascript" :value="code" />
  </div>
</template>

<script>
import { Skeleton } from '@components/ui/skeleton'
import { columns } from './TableData/applicationListColumns.ts'
import {Card} from "@components/ui/card/index.js";
import {useServiceClientStore} from "@store/serviceClientStore.js";
import {useRoute, useRouter} from "vue-router";
import {serviceClientReady} from "@store/useServiceClientReady.js";
import {useApplicationStore} from "@store/useApplicationStore.js";
import {useObjectStore} from "@store/useObjectStore.js";
import MonacoEditor from "vue-monaco";
import { h } from 'vue'
MonacoEditor.render = () => h('div')

export default {
  emits: ['rowClick'],

  setup () {
    return {
      s: useServiceClientStore(),
      app: useApplicationStore(),
      obj: useObjectStore(),
      columns: columns,
      router: useRouter(),
      route: useRoute(),
    }
  },

  data() {
    return {
      code: null,
      data: [],
      loading: false,
      rxsub: null,
    }
  },

  components: {
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

      this.rxsub = object.subscribe(aObj => {
        console.log("OBJ UPDATE: %o", aObj);
        this.data = aObj;
        this.code = JSON.stringify(aObj);
        this.loading = false;
      });
    },
    stopObjectSync: function() {
      this.rxsub?.unsubscribe();
      this.rxsub = null;
    }
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
}
</script>
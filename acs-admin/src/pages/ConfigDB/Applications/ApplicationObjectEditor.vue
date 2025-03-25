<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->
<template>
  <Skeleton v-if="loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <div v-else>
    <div>
      <RouterLink to="./">{{application.name}}</RouterLink> - {{object.name}}
    </div>
    <textarea>
      {{data}}
    </textarea>
  </div>
</template>

<script>
import { Skeleton } from '@components/ui/skeleton'
import DataTable from '@components/ui/data-table/DataTable.vue'
import { columns } from './applicationListColumns.ts'
import {Card} from "@components/ui/card/index.js";
import {useServiceClientStore} from "@store/serviceClientStore.js";
import {useRoute, useRouter} from "vue-router";
import {serviceClientReady} from "@store/useServiceClientReady.js";
import * as rxu from "@amrc-factoryplus/rx-util";
import * as rx from "rxjs";
import * as imm from "immutable";
import {useApplicationStore} from "@store/useApplicationStore.js";
import {useObjectStore} from "@store/useObjectStore.js";

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
      data: [],
      loading: false,
      rxsub: null,
    }
  },

  components: {
    Card,
    Skeleton,
    DataTable,
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
        this.loading = false;
      });
    },
    stopObjectSync: function() {
      this.rxsub?.unsubscribe();
      this.rxsub = null;
    }
  },

  async mounted () {
    this.startObjectSync()
  },

  unmounted () {
    this.stopObjectSync()
  },
}
</script>
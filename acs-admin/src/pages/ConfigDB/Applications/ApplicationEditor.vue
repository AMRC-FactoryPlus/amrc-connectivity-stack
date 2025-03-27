<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->
<template>
  <div class="flex justify-between">
    <span>{{application?.name}}</span>
    <Button disabled>Add Entry</Button>
  </div>
  <Skeleton v-if="loading || app.loading" v-for="i in 10" class="h-16 rounded-lg mb-2"/>
  <DataTableSearchable v-else
                       :data="data"
                       :default-sort="initialSort"
                       :columns="columns"
                       :filters="[]"
                       :selected-objects="[]"
                       :clickable="true"
                       :search-key="null"
                       :limit-height="false"
                       @row-click="e => objectClick(e.original)" />
</template>

<script>
import { Skeleton } from '@components/ui/skeleton'
import DataTableSearchable from "@components/ui/data-table-searchable/DataTableSearchable.vue";
import { columns } from './TableData/applicationObjectListColumns.ts'
import {Card} from "@components/ui/card/index.js";
import {useRoute, useRouter} from "vue-router";
import {useApplicationStore} from "@store/useApplicationStore.js";
import {useObjectStore} from "@store/useObjectStore.js";
import {useServiceClientStore} from "@store/serviceClientStore.js";
import {serviceClientReady} from "@store/useServiceClientReady.js";
import {UUIDs} from "@amrc-factoryplus/service-client";
import * as rxu from "@amrc-factoryplus/rx-util";
import * as rx from "rxjs";
import * as imm from "immutable";
import {Button} from "@components/ui/button/index.js";

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
      rxsub: null,
      data: [],
      loading: false,
    }
  },

  components: {
    Button,
    Card,
    Skeleton,
    DataTableSearchable,
  },

  computed: {
    initialSort () {
      return [{
        id: 'name',
        desc: false
      }]
    },
    application () {
      return this.app.data.find(a => a.uuid === this.route.params.application)
    },
  },

  methods: {
    objectClick: function(obj) {
      console.log(obj)
      if (obj.uuid) {
        this.router.push({ path: `/configdb/applications/${this.route.params.application}/${obj.uuid}` })
      } else {
        this.router.push({ path: `/configdb/applications/${this.route.params.application}` })
      }
    },
    startObjectSync: async function() {
      this.loading = true;

      // Wait until the store is ready before attempting to fetch data
      await serviceClientReady();

      const cdb = this.s.client.ConfigDB;
      const objs = this.obj.maps;

      // This gives an Observable of Sets
      const App = this.route.params.application;
      const appObjs = rxu.rx(
          rx.combineLatest(
              cdb.watch_list(App)),
          rx.map(imm.Set.union),
          rx.map(ps => {
            console.log("appObjs", ps)
            return ps.filter(p => p != App)
          }),
      );

      const details = rxu.rx(
          rx.combineLatest(objs, appObjs),
          rx.map(([objs, appObjs]) => {
            console.log("details", appObjs)
            return appObjs.map(uuid =>
                objs.get(uuid, { name: "UNKNOWN", class: { name: "UNKNOWN" } }))
                .toArray()
          }),
      );

      this.rxsub = details.subscribe(aObjs => {
        console.log("OBJS UPDATE: %o", aObjs);
        this.data = aObjs;
        this.loading = false;
      });
    },
    stopObjectSync: function() {
      this.rxsub?.unsubscribe();
      this.rxsub = null;
    }
  },

  async mounted () {
    // Start a reactive fetch via the notify interface
    this.obj.start()
    this.app.start()

    this.startObjectSync()
  },

  unmounted () {
    this.obj.stop()
    this.app.stop()

    this.stopObjectSync()
  },
}
</script>
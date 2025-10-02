<!--
  - Copyright (c) University of Sheffield AMRC 2025.
  -->

<template>
  <div class="flex items-center">
    <div class="flex items-center p-3">
      <RouterLink :to="`/configdb/${currentApplication ? 'applications' : 'objects'}`">
        <Button title="Go to application" variant="ghost" size="sm">
          <div>{{currentApplication ? 'Applications' : 'Objects'}}</div>
        </Button>
      </RouterLink>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button title="Go to application" variant="ghost" size="plain" class="p-2">
            <div class="flex flex-col">
              <i style="font-size: 9pt" class="fa-solid fa-chevron-up -mb-0.5"></i>
              <i style="font-size: 9pt" class="fa-solid fa-chevron-down -mt-0.5"></i>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <RouterLink to="/configdb/applications">
            <DropdownMenuItem class="cursor-pointer">Applications</DropdownMenuItem>
          </RouterLink>
          <RouterLink to="/configdb/objects">
            <DropdownMenuItem class="cursor-pointer">Objects</DropdownMenuItem>
          </RouterLink>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <span>/</span>
    <div v-if="currentApplication" class="flex items-center p-3">
      <RouterLink :to="`/configdb/applications/${currentApplication?.uuid}`">
        <Button title="Go to application" variant="ghost" size="sm">
          <i class="fa-solid fa-puzzle-piece mr-2"></i>
          <div :class="!currentObject ? '!font-bold' : ''">{{currentApplication?.name}}</div>
        </Button>
      </RouterLink>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button title="Go to application" variant="ghost" size="plain" class="p-2">
            <div class="flex flex-col">
              <i style="font-size: 9pt" class="fa-solid fa-chevron-up -mb-0.5"></i>
              <i style="font-size: 9pt" class="fa-solid fa-chevron-down -mt-0.5"></i>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <RouterLink :key="application.uuid" v-for="application in applications" :to="`/configdb/applications/${application.uuid}`">
            <DropdownMenuItem class="cursor-pointer">{{application.name}}</DropdownMenuItem>
          </RouterLink>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <span v-if="currentObject">/</span>
    <div v-if="currentObject" class="flex items-center p-3">
      <RouterLink :to="`/configdb/applications/${currentApplication?.uuid}/${currentObject?.uuid}`">
        <Button title="Go to object" variant="ghost" size="sm">
          <i class="fa-solid fa-cube mr-2"></i>
          <div class="font-bold">{{currentObject?.name}}</div>
        </Button>
      </RouterLink>
      <DropdownMenu>
        <DropdownMenuTrigger>
          <Button title="Go to object" variant="ghost" size="plain" class="p-2">
            <div class="flex flex-col">
              <i style="font-size: 9pt" class="fa-solid fa-chevron-up -mb-0.5"></i>
              <i style="font-size: 9pt" class="fa-solid fa-chevron-down -mt-0.5"></i>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <RouterLink :key="object.uuid" v-for="object in objects" :to="`/configdb/applications/${currentApplication?.uuid}/${object?.uuid}`">
            <DropdownMenuItem class="cursor-pointer">{{object.name}}</DropdownMenuItem>
          </RouterLink>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>
<script>

import { useApplicationStore } from '@store/useApplicationStore.js'
import { useObjectStore } from '@store/useObjectStore.js'
import { useServiceClientStore } from '@store/serviceClientStore.js'
import { serviceClientReady } from '@store/useServiceClientReady.js'
import * as rxu from '@amrc-factoryplus/rx-util'
import * as rx from 'rxjs'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@components/ui/button/index.js'

export default {
  name: 'ConfigDBBreadcrumbs',

  components: {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
  },

  setup () {
    return {
      useApplicationStore,
      s: useServiceClientStore(),
      obj: useObjectStore(),
    }
  },

  mounted () {
    useApplicationStore().start()
    this.obj.start()
    this.startAppObjectSync()
  },

  unmounted () {
    this.stopAppObjectSync()
  },

  watch: {
    '$route.params.application': {
      handler: function(newVal, oldVal) {
        if (newVal !== oldVal) {
          this.stopAppObjectSync();
          this.startAppObjectSync();
        }
      },
      immediate: true
    }
  },

  computed: {
    route () {
      return this.$route
    },

    // ║  Applications  ║
    // ╚════════════════╝
    applications () {
      return useApplicationStore().data
    },
    currentApplication () {
      return useApplicationStore().data.find((application) => application.uuid === this.$route.params.application)
    },

    // ║  Objects  ║
    // ╚═══════════╝
    objects () {
      return this.appObjects || []
    },
    currentObject () {
      if (useObjectStore().data instanceof Array) {
        return useObjectStore().data.find((object) => object.uuid === this.$route.params.object)
      }
    },
  },

  methods: {
    async startAppObjectSync() {
      // Wait until the store is ready before attempting to fetch data
      await serviceClientReady();

      // Only start if we have an application
      if (!this.$route.params.application) {
        this.appObjects = [];
        return;
      }

      const cdb = this.s.client.ConfigDB;
      const objs = this.obj.maps;

      // This gives an Observable of objects for the current application
      const appUuid = this.$route.params.application;
      const appObjs = cdb.watch_list(appUuid);

      const details = rxu.rx(
        rx.combineLatest(objs, appObjs),
        rx.map(([objs, appObjs]) => {
          return appObjs.map(uuid =>
            objs.get(uuid, { name: "UNKNOWN", class: { name: "UNKNOWN" } }))
            .toArray()
        }),
      );

      this.rxsub = details.subscribe(appObjects => {
        console.debug("APP OBJECTS UPDATE: %o", appObjects);
        this.appObjects = appObjects;
      });
    },

    stopAppObjectSync() {
      if (this.rxsub) {
        this.rxsub.unsubscribe();
        this.rxsub = null;
      }
    }
  },

  data() {
    return {
      rxsub: null,
      appObjects: [],
    }
  }
}
</script>

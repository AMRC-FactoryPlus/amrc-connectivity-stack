<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <Toaster visible-toasts="5" rich-colors class="pointer-events-auto"/>
  <SidebarProvider>
    <Sidebar v-if="!l.fullscreen && s.loaded" class="bg-white dark:bg-slate-800 z-20">
      <SidebarHeader class="border-b h-16">
        <SidebarMenu>
          <SidebarMenuItem>
            <div class="flex items-center gap-2.5 h-12 pl-2">
              <div class="flex aspect-square size-6 items-center justify-center">
                <img src="/favicon.svg">
              </div>
              <div class="flex flex-col gap-0.5 leading-none">
                <h1 class="font-bold text-base h-4">ACS {{acs_version}}</h1>
                <h2 class="text-gray-500 text-sm">{{s.username}}</h2>
              </div>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <Nav/>
        <SidebarGroup>
          <SidebarGroupLabel class="mb-2">Edge Clusters & Devices</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <EdgeClusterList/>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <div class="mt-auto p-4">
          <Card>
            <CardHeader class="p-2 pt-0 md:p-4">
              <CardTitle>Factory+</CardTitle>
              <CardDescription>
                The AMRC Connectivity Stack is an implementation of the
                Factory+ framework.
              </CardDescription>
            </CardHeader>
            <CardContent class="p-2 pt-0 md:p-4 md:pt-0">
              <Button size="sm" class="w-full" as-child>
                <a href="https://factoryplus.app.amrc.co.uk">
                  Read More
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </SidebarContent>
      <SidebarRail/>
    </Sidebar>

    <SidebarInset>
      <header v-if="!l.fullscreen && s.loaded"
          class="flex justify-between items-center border-b px-4 h-16 flex-shrink-0 lg:px-6 sticky top-0 bg-white z-10">
        <div class="flex items-center justify-center gap-2">
          <i :class="`fa-solid fa-${$route.meta.icon}`"></i>
          <h3 class="text-lg font-bold tracking-tight">{{$route.meta.name}}</h3>
        </div>
        <div class="flex items-center justify-center">
          <SidebarTrigger/>
          <Button title="Toggle fullscreen" variant="ghost" size="icon" @click="l.toggleFullscreen"><i class="fa-solid fa-expand"></i></Button>
          <Button class="ml-3" variant="link" size="icon" @click="logout">Logout</Button>
        </div>
      </header>

      <main class="flex flex-col max-h-[calc(100vh-4rem)] lg:gap-4 lg:pt-4 lg:px-4 flex-grow-0 overflow-y-auto pb-4">
        <NewClusterDialog/>
        <NewEdgeDeploymentDialog/>
        <MoveHostDialog/>
        <NewDeviceDialog/>
        <NewConnectionDialog/>
        <NewBridgeDialog/>
        <NewISA95NodeDialog/>
        <BulkPlacementImportDialog/>
        <MergeISA95NodeDialog/>
        <MoveISA95NodeDialog/>
        <RouterView/>
        <!-- Kept from the first visit to the Explorer page until
             sign-out, and hidden on other pages, so the Explorer keeps
             its subscriptions and pop-out window while you look
             elsewhere. See ExplorerFrame.vue. -->
        <ExplorerFrame v-if="explorer_kept && s.loaded" v-show="$route.path === '/explorer'"/>
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>

<script>
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import Nav from '@/components/Nav/Nav.vue'
import EdgeClusterList from '@/components/Nav/EdgeClusterList.vue'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { oidc_session } from '@/lib/oidc.js'
import { useLayoutStore } from '@/store/layoutStore.js'
import { useEventListener, useMagicKeys } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { defineAsyncComponent, ref, watch } from 'vue'
import { is_search_shortcut, request_explorer_search } from '@/lib/explorer-search.js'
import { Toaster } from '@/components/ui/sonner'
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger } from '@/components/ui/sidebar'
import NewClusterDialog from '@components/EdgeManager/EdgeClusters/NewClusterDialog.vue'
import NewEdgeDeploymentDialog from '@components/EdgeManager/Nodes/NewEdgeDeploymentDialog.vue'
import MoveHostDialog from '@components/EdgeManager/Nodes/MoveHostDialog.vue'
import NewConnectionDialog from '@components/EdgeManager/Connections/NewConnectionDialog.vue'
import NewDeviceDialog from '@components/EdgeManager/Devices/NewDeviceDialog.vue'
import NewBridgeDialog from '@components/Bridges/NewBridgeDialog.vue'
import NewISA95NodeDialog from '@components/ISA95/NewISA95NodeDialog.vue'
import BulkPlacementImportDialog from '@components/ISA95/BulkPlacementImportDialog.vue'
import MergeISA95NodeDialog from '@components/ISA95/MergeISA95NodeDialog.vue'
import MoveISA95NodeDialog from '@components/ISA95/MoveISA95NodeDialog.vue'
import { ACS_VERSION } from '@/lib/version.js'

export default {
  name: 'App',

  setup () {
    const { escape } = useMagicKeys()

    /* ⌘K / Ctrl+K on any page opens the Explorer's search. */
    const router = useRouter()
    useEventListener(window, 'keydown', event => {
      if (!is_search_shortcut(event)) return
      event.preventDefault()
      if (router.currentRoute.value.path !== '/explorer') router.push('/explorer')
      request_explorer_search()
    })

    /* The Explorer's frame is made on the first visit to its page and
     * dropped at sign-out, so the next user starts afresh. */
    const s = useServiceClientStore()
    const explorer_kept = ref(false)
    watch(() => router.currentRoute.value.path, path => {
      if (path === '/explorer') explorer_kept.value = true
    }, { immediate: true })
    watch(() => s.loaded, loaded => {
      if (!loaded) explorer_kept.value = router.currentRoute.value.path === '/explorer'
    })

    return {
      acs_version: ACS_VERSION,
      explorer_kept,
      s,
      l: useLayoutStore(),
      escape,
    }
  },

  components: {
    ExplorerFrame: defineAsyncComponent(() => import('@components/Explorer/ExplorerFrame.vue')),
    NewClusterDialog,
    NewEdgeDeploymentDialog,
    MoveHostDialog,
    NewDeviceDialog,
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarInput,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarRail,
    SidebarTrigger,
    Badge,
    Button,
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Input,
    Sheet,
    SheetContent,
    SheetTrigger,
    Nav,
    EdgeClusterList,
    Toaster,
    NewConnectionDialog,
    NewBridgeDialog,
    NewISA95NodeDialog,
    BulkPlacementImportDialog,
    MergeISA95NodeDialog,
    MoveISA95NodeDialog,
  },

  watch: {
    escape (pressed) {
      if (pressed) {
        this.l.toggleFullscreen()
      }
    },
  },

  methods: {
    logout(){
      // Cleanup the client store state.
      this.s.logout();
      // With Keycloak, end its session too; it sends the browser back
      // here, which asks the person to sign in again.
      const oidc = oidc_session();
      if (oidc) {
        oidc.sign_out();
        return;
      }
      this.$router.push("/login");
    }
  },

  async mounted () {
    this.$router.isReady().then(() => {
      if (this.$route.query.fullscreen) {
        this.l.toggleFullscreen(this.$route.query.fullscreen === 'true')
      }
    })
  },

  data () {
    return {}
  },
}
</script>

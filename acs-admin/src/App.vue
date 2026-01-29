<!--
  - Copyright (c) University of Sheffield AMRC 2026.
  -->

<template>
  <Toaster rich-colors class="pointer-events-auto"/>
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
        <NewDeviceDialog/>
        <NewConnectionDialog/>
        <NewBridgeDialog/>
        <RouterView/>
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
import { useLayoutStore } from '@/store/layoutStore.js'
import { useMagicKeys } from '@vueuse/core'
import { Toaster } from '@/components/ui/sonner'
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger } from '@/components/ui/sidebar'
import NewClusterDialog from '@components/EdgeManager/EdgeClusters/NewClusterDialog.vue'
import NewEdgeDeploymentDialog from '@components/EdgeManager/Nodes/NewEdgeDeploymentDialog.vue'
import NewConnectionDialog from '@components/EdgeManager/Connections/NewConnectionDialog.vue'
import NewDeviceDialog from '@components/EdgeManager/Devices/NewDeviceDialog.vue'
import NewBridgeDialog from '@components/Bridges/NewBridgeDialog.vue'
import { ACS_VERSION } from '@/lib/version.js'

export default {
  name: 'App',

  setup () {
    const { escape } = useMagicKeys()

    return {
      acs_version: ACS_VERSION,
      s: useServiceClientStore(),
      l: useLayoutStore(),
      escape,
    }
  },

  components: {
    NewClusterDialog,
    NewEdgeDeploymentDialog,
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
      this.$router.push("/login");
    }
  },

  async mounted () {

    // Check if opts exists in local storage
    if (localStorage.getItem('opts')) {
      // If it does then create the service client
      await this.s.login(JSON.parse(localStorage.getItem('opts')))
    }

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

<!--
  - Copyright (c) University of Sheffield AMRC 2024.
  -->

<template>
  <Toaster rich-colors/>
  <div class="grid h-screen overflow-auto w-full"
      :class="!l.fullscreen ? 'md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]' : 'grid-cols-1'">
    <div v-if="!l.fullscreen" class="hidden border-r bg-muted/40 md:block">
      <div class="flex h-full max-h-screen flex-col">
        <div class="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
          <a href="/" class="flex items-center gap-2 font-semibold">
            <img class="size-4" src="/favicon.svg">
            <span class="">ACS</span>
          </a>
        </div>
        <div class="flex-1 p-2">
          <Nav/>
        </div>
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
      </div>
    </div>
    <div class="flex flex-col overflow-auto">
      <header v-if="!l.fullscreen"
          class="flex justify-between items-center border-b px-4 lg:h-[60px] flex-shrink-0 lg:px-6">
        <div class="flex items-center justify-center gap-2">
          <i :class="`fa-solid fa-${$route.meta.icon}`"></i>
          <h3 class="text-lg font-bold tracking-tight">{{$route.meta.name}}</h3>
        </div>
        <div class="flex items-center justify-center gap-3">
          <Button variant="ghost" size="icon" @click="l.toggleFullscreen"><i class="fa-solid fa-expand"></i></Button>
          <Button variant="link" size="icon" @click="s.logout">Logout</Button>
        </div>
      </header>
      <main class="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
        <RouterView/>
      </main>
    </div>
  </div>
</template>

<script>
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import Nav from '@/components/Nav.vue'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { useLayoutStore } from '@/store/layoutStore.js'
import { useMagicKeys } from '@vueuse/core'
import { Toaster } from '@/components/ui/sonner'

export default {
  name: 'App',

  setup () {
    const { escape } = useMagicKeys()

    return {
      s: useServiceClientStore(),
      l: useLayoutStore(),
      escape,
    }
  },

  components: {
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
    Toaster
  },

  watch: {
    escape (pressed) {
      if (pressed) {
        this.l.toggleFullscreen()
      }
    },
  },

  async mounted () {
    // Check if opts exists in local storage
    if (localStorage.getItem('opts')) {
      // If it does then create the service client
      this.s.login(JSON.parse(localStorage.getItem('opts')))
    }


    this.$router.isReady().then(() => {
      if (this.$route.query.fullscreen) {
        this.l.toggleFullscreen(this.$route.query.fullscreen === 'true')
      }
    })
  },
}
</script>

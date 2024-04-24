<template>
  <div class="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
    <div class="hidden border-r bg-muted/40 md:block">
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
    <div class="flex flex-col">
      <header class="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
        <!--        <Sheet>-->
        <!--          <SheetTrigger as-child>-->
        <!--            <Button-->
        <!--                variant="outline"-->
        <!--                size="icon"-->
        <!--                class="shrink-0 md:hidden"-->
        <!--            >-->
        <!--              <Menu class="h-5 w-5" />-->
        <!--              <span class="sr-only">Toggle navigation menu</span>-->
        <!--            </Button>-->
        <!--          </SheetTrigger>-->
        <!--          <SheetContent side="left" class="flex flex-col">-->
        <!--            <nav class="grid gap-2 text-lg font-medium">-->
        <!--              <a-->
        <!--                  href="#"-->
        <!--                  class="flex items-center gap-2 text-lg font-semibold"-->
        <!--              >-->
        <!--                <Package2 class="h-6 w-6" />-->
        <!--                <span class="sr-only">Acme Inc</span>-->
        <!--              </a>-->
        <!--              <a-->
        <!--                  href="#"-->
        <!--                  class="mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground"-->
        <!--              >-->
        <!--                <Home class="h-5 w-5" />-->
        <!--                Dashboard-->
        <!--              </a>-->
        <!--              <a-->
        <!--                  href="#"-->
        <!--                  class="mx-[-0.65rem] flex items-center gap-4 rounded-xl bg-muted px-3 py-2 text-foreground hover:text-foreground"-->
        <!--              >-->
        <!--                <ShoppingCart class="h-5 w-5" />-->
        <!--                Orders-->
        <!--                <Badge class="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-full">-->
        <!--                  6-->
        <!--                </Badge>-->
        <!--              </a>-->
        <!--              <a-->
        <!--                  href="#"-->
        <!--                  class="mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground"-->
        <!--              >-->
        <!--                <Package class="h-5 w-5" />-->
        <!--                Products-->
        <!--              </a>-->
        <!--              <a-->
        <!--                  href="#"-->
        <!--                  class="mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground"-->
        <!--              >-->
        <!--                <Users class="h-5 w-5" />-->
        <!--                Customers-->
        <!--              </a>-->
        <!--              <a-->
        <!--                  href="#"-->
        <!--                  class="mx-[-0.65rem] flex items-center gap-4 rounded-xl px-3 py-2 text-muted-foreground hover:text-foreground"-->
        <!--              >-->
        <!--                <LineChart class="h-5 w-5" />-->
        <!--                Analytics-->
        <!--              </a>-->
        <!--            </nav>-->
        <!--            <div class="mt-auto">-->
        <!--              <Card>-->
        <!--                <CardHeader>-->
        <!--                  <CardTitle>Upgrade to Pro</CardTitle>-->
        <!--                  <CardDescription>-->
        <!--                    Unlock all features and get unlimited access to our-->
        <!--                    support team.-->
        <!--                  </CardDescription>-->
        <!--                </CardHeader>-->
        <!--                <CardContent>-->
        <!--                  <Button size="sm" class="w-full">-->
        <!--                    Upgrade-->
        <!--                  </Button>-->
        <!--                </CardContent>-->
        <!--              </Card>-->
        <!--            </div>-->
        <!--          </SheetContent>-->
        <!--        </Sheet>-->
        <div class="w-full flex-1">
          <!--          <form>-->
          <!--            <div class="relative">-->
          <!--              <Search class="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />-->
          <!--              <Input-->
          <!--                  type="search"-->
          <!--                  placeholder="Search products..."-->
          <!--                  class="w-full appearance-none bg-background pl-8 shadow-none md:w-2/3 lg:w-1/3"-->
          <!--              />-->
          <!--            </div>-->
          <!--          </form>-->
        </div>
        <h3 class="text-lg font-bold tracking-tight">{{baseUrl}}</h3>
        <Button variant="link" size="icon" @click="s.logout">Logout</Button>
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

export default {
  name: 'App',

  setup () {
    return {
      s: useServiceClientStore(),
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
  },

  computed: {
    baseUrl () {
      return import.meta.env.VITE_EXTERNAL_DOMAIN
    },
  },

  mounted () {
    // Check if opts exists in local storage
    if (localStorage.getItem('opts')) {
      // If it does then create the service client
      this.s.login(JSON.parse(localStorage.getItem('opts')))
    }

    // If it does then create the service client

    // It doesn't then do nothing and we'll show the login page
  },
}
</script>

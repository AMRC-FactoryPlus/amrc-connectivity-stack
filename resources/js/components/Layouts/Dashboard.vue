<!--
  -  Factory+ / AMRC Connectivity Stack (ACS) Manager component
  -  Copyright 2023 AMRC
  -->

<template>
  <div class="flex flex-col h-screen">
    <header class="w-full">
      <div class="relative z-10 flex-shrink-0 h-16 flex">
        <button @click="mobileSidebarOpen = !mobileSidebarOpen" type="button"
                class="px-4 text-brand focus:outline-none md:hidden">
          <span class="sr-only">Open sidebar</span>
          <!-- Heroicon name: outline/menu-alt-2 -->
          <svg class="h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/>
          </svg>
        </button>
        <div class="flex-1 flex shadow-sm justify-between px-4 sm:px-6">
          <div class="flex items-center">
            <h1 class="mr-3 hidden md:inline divide"><span class="font-bold">Factory+</span> Device Management Portal</h1>
            <h1 class="mr-3 md:hidden divide"><span class="font-bold">Factory+</span></h1>
          </div>
          <div class="ml-2 flex items-center space-x-4 sm:ml-6 sm:space-x-6">
            <!-- Profile dropdown -->
            <div class="relative flex-shrink-0 flex items-center">
              <div v-if="$root.$data.user.administrator" class="bg-white tracking-wide text-sm  px-3 py-1 font-black text-brand mr-3">ADMIN</div>
              <button @click="toggleUsernameDropdown" type="button"
                      class="flex p-1 items-center justify-center text-brand  group">
                <div class="mr-2">{{ $root.$data.user.username }}</div>
                <i class="fa-sharp fa-solid fa-chevron-down text-xs text-brand opacity-70 group-hover:opacity-100"></i>
              </button>
              <div v-if="showUsernameDropdown"
                   class="absolute right-0 mt-24 w-48  shadow-lg py-1 bg-white ring-1 ring-black ring-opacity-5 focus:outline-none"
                   role="menu" aria-orientation="vertical" aria-labelledby="user-menu-button" tabindex="-1">
                <a @click="logout" class="block px-4 py-2 text-gray-500 hover:text-gray-700 cursor-pointer" role="menuitem" tabindex="-1" id="user-menu-item-1">Logout</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="bg-gray-100 flex flex-grow">
      <!-- Sidebar -->
      <div class="hidden w-32 bg-gray-100 overflow-y-auto md:block flex flex-col">
        <div class="w-full flex flex-col items-center flex-1 h-full">
          <div class="flex flex-col flex-1 p-2 w-full space-y-1">
            <a href="/"
               :class="pageActive('nodes') ? 'bg-brand bg-opacity-10 text-brand' : 'hover:bg-brand hover:bg-opacity-10 hover:text-brand'"
               class="text-brand group w-full p-3 flex flex-col items-center text-xs font-medium">
              <i class="fa-sharp fa-solid fa-sitemap fa-2x" :class="pageActive('nodes') ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'"></i>
              <span class="mt-2">Nodes</span>
            </a>
            <a v-if="$root.$data.user.administrator" href="/edge-agents"
               :class="pageActive('edge-agents') ? 'bg-brand bg-opacity-10 text-brand' : 'hover:bg-brand hover:bg-opacity-10 hover:text-brand'"
               class="text-brand group w-full p-3 flex flex-col items-center text-xs font-medium">
              <i class="fa-sharp fa-solid fa-language fa-2x" :class="pageActive('edge-agents') ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'"></i>
              <span class="mt-2 text-center">Edge Agents</span>
            </a>
            <a v-if="$root.$data.user.administrator" href="/schema-editor"
               :class="pageActive('schema-editor') ? 'bg-brand bg-opacity-10 text-brand' : 'hover:bg-brand hover:bg-opacity-10 hover:text-brand'"
               class="text-brand group w-full p-3 flex flex-col items-center text-xs font-medium">
              <i class="fa-sharp fa-solid fa-code fa-2x" :class="pageActive('schema-editor') ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'"></i>
              <span class="mt-2 text-center">Schema Editor</span>
            </a>
            <div class="flex-1"></div>
            <a href="/preferences"
               :class="pageActive('preferences') ? 'bg-gray-400 bg-opacity-10 text-gray-400' : 'hover:bg-gray-400 hover:bg-opacity-10 hover:text-gray-400'"
               class="text-gray-400 group w-full p-3 flex flex-col items-center text-xs font-medium">
              <i class="fa-sharp fa-solid fa-cog fa-2x" :class="pageActive('preferences') ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'"></i>
              <span class="mt-2">Preferences</span>
            </a>
          </div>
        </div>
      </div>

      <!--
        Mobile menu
        Off-canvas menu for mobile, show/hide based on off-canvas menu state.
      -->
      <div v-if="mobileSidebarOpen" class="md:hidden z-50" role="dialog" aria-modal="true">
        <div class="fixed inset-0 z-40 flex">
          <!--
            Off-canvas menu overlay, show/hide based on off-canvas menu state.

            Entering: "transition-opacity ease-linear duration-300"
              From: "opacity-0"
              To: "opacity-100"
            Leaving: "transition-opacity ease-linear duration-300"
              From: "opacity-100"
              To: "opacity-0"
          -->
          <div class="fixed inset-0 bg-gray-600 bg-opacity-75" aria-hidden="true"></div>

          <!--
            Off-canvas menu, show/hide based on off-canvas menu state.

            Entering: "transition ease-in-out duration-300 transform"
              From: "-translate-x-full"
              To: "translate-x-0"
            Leaving: "transition ease-in-out duration-300 transform"
              From: "translate-x-0"
              To: "-translate-x-full"
          -->
          <div class="relative max-w-xs w-full bg-brand pt-5 pb-4 flex-1 flex flex-col">
            <!--
              Close button, show/hide based on off-canvas menu state.

              Entering: "ease-in-out duration-300"
                From: "opacity-0"
                To: "opacity-100"
              Leaving: "ease-in-out duration-300"
                From: "opacity-100"
                To: "opacity-0"
            -->
            <div class="absolute top-1 right-0 -mr-14 p-1">
              <button @click="mobileSidebarOpen = false" type="button" class="h-12 w-12 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-white">
                <!-- Heroicon name: outline/x -->
                <svg class="h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
                <span class="sr-only">Close sidebar</span>
              </button>
            </div>

            <div class="mt-5 flex-1 h-0 px-2 overflow-y-auto">
              <nav class="h-full flex flex-col">
                <div class="space-y-1">
                  <!-- Current: "bg-indigo-800 text-white", Default: "text-indigo-100 hover:bg-indigo-800 hover:text-white" -->
                  <a href="/"
                     class="text-indigo-100 hover:bg-white hover:bg-opacity-20 hover:text-white group py-2 px-3  flex items-center text-sm font-medium">
                    <!--
                      Heroicon name: outline/home

                      Current: "text-white", Default: "text-indigo-300 group-hover:text-white"
                    -->
                    <i class="fa-sharp fa-solid fa-sitemap mr-3"></i>
                    <span>Nodes</span>
                  </a>
                </div>
              </nav>
            </div>
          </div>

          <div class="flex-shrink-0 w-14" aria-hidden="true">
            <!-- Dummy element to force sidebar to shrink to fit close icon -->
          </div>
        </div>
      </div>

      <!-- Content area -->
      <div class="flex-1 flex flex-col h-page">
        <!-- Main content -->
        <div class="flex items-stretch h-page flex flex-col">
          <main class="h-page flex flex-col flex-grow">
            <!-- Primary column -->
            <section aria-labelledby="primary-heading" class="min-w-0 flex flex-col overflow-hidden lg:order-last bg-white h-page">
              <slot></slot>
            </section>
          </main>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'Dashboard',

  methods: {
    toggleUsernameDropdown() {
      this.showUsernameDropdown = !this.showUsernameDropdown;
    },

    pageActive(link) {
      return window.location.pathname.startsWith('/' + link);
    },

    logout() {
      axios.post('/logout').then(() => {
        this.goto_url('/login')
      });
    }
  },

  data() {
    return {
      showUsernameDropdown: false,
      mobileSidebarOpen: false,
    };
  },
};
</script>

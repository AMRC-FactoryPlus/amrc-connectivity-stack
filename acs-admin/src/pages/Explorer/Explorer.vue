<!--
  - ACS Admin
  - The Explorer page, which App.vue fills with the framed i3X Explorer
  - Copyright 2026 University of Sheffield
  -->

<!-- The Explorer's frame is not part of this page, because leaving the
     page would unmount it and stop the Explorer's subscriptions and
     close its pop-out window. App.vue keeps ExplorerFrame alive and
     shows it while this route is current, so the page itself is empty. -->
<template>
  <div class="hidden"/>
</template>

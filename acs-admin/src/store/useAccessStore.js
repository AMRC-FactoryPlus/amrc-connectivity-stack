/*
 * ACS Admin
 * The logged-in user's own permissions, for hiding controls they can't use
 * Copyright 2026 University of Sheffield
 */

import { defineStore } from 'pinia'
import { markRaw, watch } from 'vue'

import { useServiceClientStore } from '@store/serviceClientStore.js'
import { make_checker, Status } from '@/lib/access/acl.js'

const OWN_ACL = 'v2/whoami/acl'
const RETRY_MS = [2000, 5000, 15000, 30000]

/* Use in templates as `access.check.can(Perm, target)`. Until the ACL
 * arrives every check is false, so controls appear rather than
 * flash up and vanish. Against an Auth that has no v2/whoami/acl the
 * checks are all true, which is how the UI behaved before. */
export const useAccessStore = defineStore('access', {
  state: () => ({
    check: make_checker({ status: Status.Loading }),
    principal: null,
    /* Bumped by stop(), so work started for an earlier login (or an
     * earlier attempt) can tell it is stale and drop its result. */
    generation: 0,
    subscription: null,
    retry_timer: null,
  }),
  actions: {
    start () {
      const s = useServiceClientStore()
      watch(() => s.ready ? s.client : null, client => {
        this.stop()
        if (client) this.load(client, this.generation, 0)
      }, { immediate: true })
    },

    stop () {
      this.generation++
      this.subscription?.unsubscribe()
      this.subscription = null
      clearTimeout(this.retry_timer)
      this.retry_timer = null
      this.check = make_checker({ status: Status.Loading })
      this.principal = null
    },

    apply (body) {
      this.principal = body.principal
      this.check = make_checker({
        status: Status.Ready,
        root: body.root,
        acl: body.acl,
      })
    },

    retry (client, gen, attempt) {
      const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]
      clearTimeout(this.retry_timer)
      this.retry_timer = setTimeout(() => {
        if (gen === this.generation) this.load(client, gen, attempt + 1)
      }, delay)
    },

    async load (client, gen, attempt) {
      let st, body
      try {
        [st, body] = await client.Auth.fetch(OWN_ACL)
      } catch (e) {
        console.error('Reading my own permissions failed:', e)
        st = null
      }
      if (gen !== this.generation) return

      if (st === 404 || st === 410) {
        /* An Auth too old to have the endpoint. Show every control
         * and let the services refuse, as before this check existed. */
        this.check = make_checker({ status: Status.Unknown })
        return
      }
      if (st !== 200 || !Array.isArray(body?.acl)) {
        /* Auth is restarting or unreachable. Keep controls hidden
         * and try again. */
        this.retry(client, gen, attempt)
        return
      }
      this.apply(body)
      this.watch_acl(client, gen)
    },

    /* Follow changes, so a grant made while the page is open shows
     * the controls it allows without a reload. */
    watch_acl (client, gen) {
      this.subscription?.unsubscribe()
      try {
        this.subscription = markRaw(client.Auth.notify.watch_full(OWN_ACL)
          .subscribe({
            next: res => {
              if (gen !== this.generation) return
              if (res.status === 200 && Array.isArray(res.body?.acl))
                this.apply(res.body)
            },
            error: e => {
              console.error('Watching my own permissions failed:', e)
              if (gen === this.generation) this.retry(client, gen, 0)
            },
          }))
      } catch (e) {
        console.error('Watching my own permissions failed:', e)
      }
    },
  },
})

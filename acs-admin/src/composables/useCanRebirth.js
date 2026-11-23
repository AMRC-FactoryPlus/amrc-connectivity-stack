/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { ref, watch } from 'vue'
import { useServiceClientStore } from '@store/serviceClientStore.js'

const REBIRTH_PERMISSION = 'fbb9c25d-386d-4966-a325-f16471d9f7be'
const WILDCARD = '00000000-0000-0000-0000-000000000000'

export function useCanRebirth (targets) {
  const permissions = ref(new Map())

  watch(targets, async (uuids) => {
    if (!uuids || uuids.length === 0) return

    const s = useServiceClientStore()
    const results = new Map()

    // Fetch the full ACL via the Auth service HTTP API.
    // We call ServiceInterface.fetch directly to avoid the
    // RxClient notify-based override of fetch_raw_acl.
    // whoami_uuid() resolves our principal server-side from whatever
    // credentials the request carries (Keycloak JWT or Basic auth), so
    // this works the same under OIDC and the password fallback - no
    // need to reconstruct a Kerberos UPN from s.username client-side.
    let acl
    try {
      const uuid = await s.client.Auth.whoami_uuid()
      const [st, json] = await s.client.Auth.fetch(
        `v2/acl/${uuid}`
      )
      if (st !== 200) throw new Error(`ACL fetch returned ${st}`)
      acl = json
    } catch (e) {
      console.error('Failed to fetch ACL for rebirth check:', e)
      return
    }

    for (const uuid of uuids) {
      const allowed = acl.some(ace =>
        ace.permission === REBIRTH_PERMISSION
        && (ace.target === uuid || ace.target === WILDCARD)
      )
      results.set(uuid, allowed)
    }

    permissions.value = results
  }, { immediate: true })

  return permissions
}

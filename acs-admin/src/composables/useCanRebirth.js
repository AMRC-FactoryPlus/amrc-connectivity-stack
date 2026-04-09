/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { ref, watch } from 'vue'
import { useServiceClientStore } from '@store/serviceClientStore.js'

const REBIRTH_PERMISSION = 'fbb9c25d-386d-4966-a325-f16471d9f7be'

export function useCanRebirth (targets) {
  const permissions = ref(new Map())

  watch(targets, async (uuids) => {
    if (!uuids || uuids.length === 0) return

    const s = useServiceClientStore()
    const results = new Map()

    await Promise.all(uuids.map(async (uuid) => {
      try {
        const allowed = await s.client.Auth.check_acl(
          s.username,
          REBIRTH_PERMISSION,
          uuid,
          false
        )
        results.set(uuid, allowed)
      } catch {
        results.set(uuid, false)
      }
    }))

    permissions.value = results
  }, { immediate: true })

  return permissions
}

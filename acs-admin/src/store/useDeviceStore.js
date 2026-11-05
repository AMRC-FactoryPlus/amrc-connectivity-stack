/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'
import { useStore } from '@store/useStore.ts'

export const useDeviceStore = () => useStore(
  'device',
  UUIDs.Class.Device,
  {
    deviceInformation: UUIDs.App.DeviceInformation,
    sparkplugAddress: UUIDs.App.SparkplugAddress,
    /* The device's ISA-95 placement, or null if it has none. */
    placement: UUIDs.App.ISA95Placement,
  }
)()

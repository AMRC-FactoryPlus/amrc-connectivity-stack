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
    sparkplugAddress: UUIDs.App.SparkplugAddress
  }
)()

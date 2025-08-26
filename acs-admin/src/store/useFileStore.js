/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import {useStore} from "@store/useStore.ts";
import { UUIDs } from "@amrc-factoryplus/service-client"


export const useFileStore = () => useStore(
    'file',
    UUIDs.Class.File,
    {
        filesConfiguration: UUIDs.App.FilesConfig
    }
)()
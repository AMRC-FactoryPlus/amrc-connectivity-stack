/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * StreamSaver, set up for the console. Import it from here, not from
 * 'streamsaver', so every download uses the console's own helper page.
 */

import streamSaver from 'streamsaver'
import { MITM_PAGE } from './stream-download.js'

/* Only in a secure context. There StreamSaver loads the helper page in
 * a hidden iframe and the page registers a service worker. The CSP
 * blocks a frame from GitHub Pages, so the console serves its own copy.
 *
 * On plain HTTP StreamSaver opens the helper in a popup instead, which
 * the CSP does not govern. A page on plain HTTP cannot register a
 * service worker, so a copy served by the console would not work there,
 * and StreamSaver's default copy stays. */
if (globalThis.isSecureContext)
    streamSaver.mitm = MITM_PAGE

export default streamSaver

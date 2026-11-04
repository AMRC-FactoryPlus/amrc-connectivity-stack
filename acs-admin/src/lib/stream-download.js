/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Streamed downloads. The console streams big files (dataset CSVs,
 * files from the Files service) to disk with StreamSaver. This module
 * holds the parts that do not need StreamSaver itself, so the unit
 * tests can load it in node.
 */

/** StreamSaver's helper page, served by the console itself from
 * public/streamsaver/.
 *
 * StreamSaver's default copy is on GitHub Pages. In a secure context
 * StreamSaver loads it in a hidden iframe, and the console's
 * Content-Security-Policy (`frame-src 'self'`) blocks that frame, so
 * the download never starts. The query string is the protocol version
 * StreamSaver 2.0.x expects; the page passes it on to its service
 * worker. See .docker/nginx.conf for the policy this page gets. */
export const MITM_PAGE = '/streamsaver/mitm.html?version=2.0.0'

/*
 * ACS Monitor component
 * Random utilities
 * Copyright 2024 AMRC
 */

import * as rx from "rxjs";

/* This will be in RxJS 8 as rx.rx. This is the final result of waiting
 * for suitable JS pipe syntax that never came... */
export function rx_rx (src, ...pipe) {
    return rx.pipe(...pipe)(rx.from(src));
}


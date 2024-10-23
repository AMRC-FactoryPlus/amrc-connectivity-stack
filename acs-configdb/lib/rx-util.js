/*
 * ACS ConfigDB
 * RX utility functions
 * Copyright 2024 University of Sheffield
 */

import rx from "rxjs";

/* This will be in RxJS 8 as rx.rx. This is the final result of waiting
 * for suitable JS pipe syntax that never came... */
function rx_rx (src, ...pipe) {
    return rx.pipe(...pipe)(rx.from(src));
}
export { rx_rx as rx };

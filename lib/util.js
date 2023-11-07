/*
 * ACS Rx utilities
 * Random useful functions
 * Copyright 2023 AMRC
 */

export function log_observer (log, label) {
    return {
        next:       v => log("NEXT %s: %o", label, v),
        error:      e => log("ERROR %s: %o", label, e),
        complete:   () => log("COMPLETE %s", label),
    };
}

export const console_observer = log_observer.bind(null, console.log);

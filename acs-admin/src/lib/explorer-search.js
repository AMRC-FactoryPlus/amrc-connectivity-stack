/*
 * ACS Admin
 * ⌘K / Ctrl+K from any page opens the i3X Explorer's search
 * Copyright 2026 University of Sheffield
 */

/* The shortcut is caught by the console on every page. It goes to the
 * Explorer page and asks the Explorer, in its frame, to open its search.
 * The frame may not be loaded yet, so a request made before the Explorer
 * has registered waits for it. While the Explorer's frame has focus it
 * catches ⌘K itself. */

let handler = null;
let pending = false;

/** True for ⌘K on a Mac or Ctrl+K elsewhere, with no other modifier. */
export function is_search_shortcut (event) {
    return Boolean(event.metaKey || event.ctrlKey)
        && !event.shiftKey && !event.altKey
        && typeof event.key === "string" && event.key.toLowerCase() === "k";
}

/** Ask the Explorer to open its search, now or as soon as it is ready. */
export function request_explorer_search () {
    if (handler) handler();
    else pending = true;
}

/**
 * Called by the Explorer page with what opens the search. A request that
 * came first is answered at once. Returns a function that unregisters.
 */
export function on_explorer_search (fn) {
    handler = fn;
    if (pending) {
        pending = false;
        fn();
    }
    return () => {
        if (handler === fn) handler = null;
    };
}

/*
 * An Access stand-in that lets every caller see everything, for tests
 * of behaviour other than access control.
 */

import { ALL_GRANTS } from "../../lib/access.js";

export const allowAll = {
    grants: async () => ALL_GRANTS,
    visible: () => undefined,
    track: () => ({ visible: () => true, stop: () => {} }),
};

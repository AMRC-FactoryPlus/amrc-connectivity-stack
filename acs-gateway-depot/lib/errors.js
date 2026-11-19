/*
 * ACS Gateway Depot
 * An error with a message meant for the person using the Admin UI.
 * Copyright 2026 University of Sheffield AMRC
 */

/* APIError from service-api carries a status and nothing else. Most of
 * what goes wrong here is something a person can put right, so we need
 * to tell them what. The API layer turns these into a JSON body. */
export class DepotError extends Error {
    constructor (status, message) {
        super(message);
        this.status = status;
    }
}

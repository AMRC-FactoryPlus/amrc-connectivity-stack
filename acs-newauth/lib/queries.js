/*
 * ACS Auth service
 * Database queries class
 * Copyright 2024 University of Sheffield AMRC
 */

/* Queries is a separate class, because sometimes we want to query on
 * the database directly, and sometimes we need to query using a query
 * function for a transaction. The model inherits from this class. */
export class Queries {
    static DBVersion = 2;

    constructor (query) {
        this.query = query;
    }

    
}

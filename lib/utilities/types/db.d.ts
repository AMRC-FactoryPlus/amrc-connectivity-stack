/**
 *  provides a basic wrapper over a database connection.
 *  Supports checking the version of the database DDL and basic transaction and reconnection support.
 */
export default class DB {
    constructor(opts: dbOptions);

    init(): Promise<DB>;

    /**
     * Returns a client connection which must be released with cli.release()
     */
    connect(): any;

    /**
     * Obtain a connection and make an SQL query.
     * @param sql SQL Query
     * @param params Parameters for query
     * @param verbose optionally overrides the global verbose setting
     */
    query(sql: string, params: any, verbose?: boolean): any;

    txn(opts: dbOptions, query: (sql: any, params: any) => {}): any;
}

/**
 * version: If this is defined, then after connecting to the database the library will run select version from version.
 * If this does not return one row matching the specified version an exception will be thrown.
 * verbose: Log every query executed.
 * readonly, isolation, deferrable: Set the transaction isolation mode.
 */
export interface dbOptions {
    version?: string;
    verbose?: boolean;
    readonly?: boolean;
    isolation?: string;
    deferrable?: boolean;
}

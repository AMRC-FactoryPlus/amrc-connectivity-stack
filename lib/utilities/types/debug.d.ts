export interface DebugConfig {
    verbose?: boolean;
    default?: string;
}

/**
 * Implementes simple configurable logging. All logs go to console.log.
 */
export class Debug {
    constructor(config?: DebugConfig)

    level: Set<any>;
    verbose: boolean;

    log(level: string, msg: string, ...args: any[]): void;
}
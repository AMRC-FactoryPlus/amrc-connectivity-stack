/// <reference types="node" />
export interface ClientContextOptions {
    krbCcache?: string;
    server: string;
    mech?: "krb5" | "spnego";
}
export interface GssSecContext {
    isComplete(): boolean;
}
export interface ServerGssSecContext extends GssSecContext {
    clientName(): string;
}
export declare function createClientContext(options: ClientContextOptions): GssSecContext;
export declare function createServerContext(): ServerGssSecContext;
export declare function initSecContext(ctx: GssSecContext, token?: Buffer): Promise<Buffer>;
export declare function acceptSecContext(ctx: ServerGssSecContext, token: Buffer): Promise<Buffer>;
export declare function setKeytabPath(path: string): undefined;
export declare function verifyCredentials(username: string, password: string, options?: {
    keytab?: string;
    serverPrincipal?: string;
}): Promise<void>;
export declare function kinit(ccname: string, username: string, password: string): Promise<string>;
export declare function kdestroy(ccname: string): Promise<undefined>;

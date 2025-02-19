

declare module "sparkplug-payload" {
    export function get(namespace: string | undefined | null): typeof import('./lib/sparkplugpayload') | null;
}

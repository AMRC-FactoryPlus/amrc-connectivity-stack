import {ServiceClient, ServiceInterface} from "../service-client";

/**
 * Discovery Service
 */
export default class Discovery extends ServiceInterface {
    constructor(fplus: ServiceClient);

    urls: Map<string, any>;

    /**
     * @deprecated Services may have multiple URLs, and we cannot do liveness testing here as we don't know all
     *  the protocols.
     * @param service UUID of service.
     */
    service_url(service: string): string | undefined;

    /**
     * Returns a list of URLs to potential providers of a given service UUID
     * @param service service function UUID
     */
    service_urls(service: string): string[];

    /**
     * Set a URL for a given service UUID
     * @param service Service UUID
     * @param url Url for service
     */
    set_service_url (service: string, url: string): void;

    /**
     * Install a function used to locate service URLs instead of querying the Directory.
     * Used internally by the Directory.
     * @param locator Locator Function
     */
    set_service_discovery(locator: (service: string) => string[]): void;
}
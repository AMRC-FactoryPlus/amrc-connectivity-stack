/* Factory+ Java client library.
 * Service discovery.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus;

import java.net.URI;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.json.*;

import io.reactivex.rxjava3.core.*;

import uk.co.amrc.factoryplus.http.*;

/* XXX The JS client performs a (cached) fetch every time, with a Map of
 * overrides. This client caches the responses from the Directory
 * indefinitely, which is definitely incorrect. However, we perform
 * not-entirely-trivial processing on the response, so even if there
 * will be no network activity I would like to know that I got a 304 and
 * can reuse the existing derived value... */

/** Service discovery.
 *
 * This service requires the <code>directory_url</code> configuration
 * parameter to bootstrap the search process.
 */
public class FPDiscovery {
    private static final Logger log = LoggerFactory.getLogger(FPDiscovery.class);

    private RequestCache<UUID, Set<URI>> cache;

    public FPDiscovery (FPServiceClient fplus)
    {
        var dir = fplus.directory();
        this.cache = new RequestCache<UUID, Set<URI>>(dir::getServiceURLs);

        var url = fplus.getUriConf("directory_url");
        log.info("Using Directory {}", url);
        setServiceURL(FPUuid.Service.Directory, url);
    }

    /** Injects a service URL obtained out-of-band.
     *
     * This method should be used when you have some additional source
     * of information about service location, for example explicit
     * configuration. URLs set with this method will override any
     * responses from the Directory.
     *
     * @param service The Service UUID.
     * @param url The service URL.
     */
    public void setServiceURL (UUID service, URI url)
    {
        cache.put(service, Set.of(url));
    }

    /** Fetches the URLs available for a service.
     *
     * This will respect URLs set with {@link #setServiceURL(UUID,URI)};
     * otherwise it will look up in the Directory.
     *
     * @param service The Service UUID.
     * @return A Set of the URIs registered.
     */
    public Single<Set<URI>> lookup (UUID service)
    {
        return cache.get(service);
    }

    /** Gets the most suitable URL to use for a service.
     *
     * Currently this simply takes one from the returned set. Selection
     * of URLs is not specified yet.
     *
     * @param service The Service UUID.
     * @return The URI to use.
     */
    public Single<URI> get (UUID service)
    {
        return lookup(service)
            .flatMap(urls -> urls.isEmpty()
                ? Single.<Set<URI>>error(new Exception("Cannot find service URL"))
                : Single.just(urls))
            /* Just take the first (only) for now. */
            .map(urls -> fixPath(urls.iterator().next()));
            //.doOnSuccess(base -> log.info("Resolved {} to {}", service, base));
    }

    /** Indicate a URL is not working.
     *
     * Not implemented.
     */
    public void remove (UUID service, URI bad)
    {
        /* Ignore for now. */
        //cache.remove(service, bad);
    }

    /* Java's URI class doesn't resolve relative URIs properly unless
     * there is an explicit path component. */
    private URI fixPath (URI uri)
    {
        return uri.getPath().length() == 0 ? uri.resolve("/") : uri;
    }

}

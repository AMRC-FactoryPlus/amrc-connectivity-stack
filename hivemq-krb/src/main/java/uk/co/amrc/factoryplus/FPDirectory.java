/* Factory+ Java client library.
 * Directory service.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus;

import java.net.URI;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.json.*;

import io.reactivex.rxjava3.core.*;

import uk.co.amrc.factoryplus.http.*;

/** The Directory service.
 */
public class FPDirectory {
    private static final Logger log = LoggerFactory.getLogger(FPDirectory.class);
    private static final UUID SERVICE = FPUuid.Service.Directory;

    private FPServiceClient fplus;

    public FPDirectory (FPServiceClient fplus)
    {
        this.fplus = fplus;
    }

    /** Fetches the URLs published for a given service.
     *
     * Fetches a Set of URIs published by the providers of the given
     * service. Currently selection of a URL from the returned Set is up
     * to the client.
     *
     * @param service The Service UUID.
     * @return A Set of the published URLs.
     */
    public Single<Set<URI>> getServiceURLs (UUID service)
    {
        log.info("Looking up {} via the Directory", service);
        return fplus.http().request(SERVICE, "GET")
            .withURIBuilder(b -> b
                .appendPath("v1/service")
                .appendPath(service.toString())
            )
            .fetch()
            .map(res -> res.ifOk()
                .flatMap(r -> r.getBody())
                .orElseGet(() -> {
                    log.error("Can't find {} via the Directory: {}",
                        service, res.getCode());
                    return new JSONArray();
                }))
            .cast(JSONArray.class)
            .flatMapObservable(Observable::fromIterable)
            //.doOnNext(o -> log.info("Service URL: {}", o))
            .cast(JSONObject.class)
            .map(o -> o.getString("url"))
            .map(URI::new)
            .collect(Collectors.toUnmodifiableSet());
    }

    /** Register a service URL with the Directory.
     *
     * Register ourselves as providing a service at the given URL. This
     * registration will be owned by the current user.
     *
     * @param service The Service UUID.
     * @param url The service URL.
     * @return A Completable indicating success or failure.
     */
    public Completable registerServiceURL (UUID service, URI url)
    {
        log.info("Registering {} with the Directory for service {}",
            url, service);
        return fplus.http().request(SERVICE, "PUT")
            .withURIBuilder(b -> b
                .appendPath("v1/service")
                .appendPath(service.toString())
                .appendPath("advertisment"))
            .withBody(new JSONObject()
                .put("url", url.toString()))
            .fetch()
            .flatMapCompletable(res ->
                res.ok() ? Completable.complete()
                : Completable.error(() ->
                    new Exception("Service registration error: " 
                        + res.getCode())));
    }
}

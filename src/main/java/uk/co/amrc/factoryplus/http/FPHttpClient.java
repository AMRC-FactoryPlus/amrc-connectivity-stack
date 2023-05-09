/* Factory+ Java client library.
 * HTTP client.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus.http;

import java.net.*;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.ServiceConfigurationError;
import java.util.UUID;
import java.util.stream.Stream;
import java.util.stream.Collectors;

import org.ietf.jgss.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.commons.lang3.tuple.Pair;

import org.apache.hc.client5.http.HttpResponseException;
import org.apache.hc.client5.http.fluent.Request;
import org.apache.hc.client5.http.fluent.Response;
import org.apache.hc.client5.http.impl.cache.CacheConfig;
import org.apache.hc.client5.http.impl.cache.CachingHttpClients;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.net.URIBuilder;

import org.apache.hc.client5.http.async.methods.SimpleHttpRequest;
import org.apache.hc.client5.http.async.methods.SimpleHttpResponse;
import org.apache.hc.client5.http.async.methods.SimpleRequestBuilder;
import org.apache.hc.client5.http.async.methods.SimpleRequestProducer;
import org.apache.hc.client5.http.async.methods.SimpleResponseConsumer;
import org.apache.hc.client5.http.cache.HttpCacheContext;
import org.apache.hc.client5.http.impl.async.CloseableHttpAsyncClient;
import org.apache.hc.client5.http.impl.cache.CachingHttpAsyncClients;
import org.apache.hc.core5.concurrent.FutureCallback;
import org.apache.hc.core5.http.HttpHost;
import org.apache.hc.core5.http.message.StatusLine;
import org.apache.hc.core5.io.CloseMode;
import org.apache.hc.core5.reactor.IOReactorConfig;
import org.apache.hc.core5.util.Timeout;

import org.json.*;

import io.reactivex.rxjava3.core.Single;

import uk.co.amrc.factoryplus.*;
import uk.co.amrc.factoryplus.gss.*;

/** HTTP (REST) client.
 */
public class FPHttpClient {
    private static final Logger log = LoggerFactory.getLogger(FPHttpClient.class);

    private FPServiceClient fplus;
    private FPDiscovery discovery;
    private CloseableHttpClient http_client;
    private CloseableHttpAsyncClient async_client;
    private RequestCache<URI, String> tokens;

    /** Internal; construct via {@link FPServiceClient}. */
    public FPHttpClient (FPServiceClient fplus)
    {
        this.fplus = fplus;

        CacheConfig cache_config = CacheConfig.custom()
            .setSharedCache(false)
            .build();
        http_client = CachingHttpClients.custom()
            .setCacheConfig(cache_config)
            .build();

        tokens = new RequestCache<URI, String>(this::tokenFor);

        final IOReactorConfig ioReactorConfig = IOReactorConfig.custom()
            .setSoTimeout(Timeout.ofSeconds(5))
            .build();

        async_client = CachingHttpAsyncClients.custom()
            .setIOReactorConfig(ioReactorConfig)
            .build();
    }

    /** Start the async client threads.
     *
     * Call this before calling any other methods.
     *
     * @throws ServiceConfigurationError
     *  If the <code>directory_url</code> config param is missing.
     */
    public void start ()
    {
        /* This can throw if the directory url is missing */
        this.discovery = fplus.discovery();

        //FPThreadUtil.logId("Running async HTTP client");
        async_client.start();
    }

    /** Creates a new request.
     *
     * @param service The service this request is directed at.
     * @param method The HTTP method to use.
     * @return A new request.
     */
    public FPHttpRequest request (UUID service, String method)
    {
        return new FPHttpRequest(this, service, method);
    }

    /** Internal; use {@link FPHttpRequest#fetch()}. */
    public Single<JsonResponse> execute (FPHttpRequest fpr)
    {
        //FPThreadUtil.logId("execute called");
        return discovery
            .get(fpr.service)
            .flatMap(base -> tokens.get(base)
                .map(tok -> fpr.resolveWith(base, tok)))
            .flatMap(rrq -> fetch(rrq.buildRequest())
                .flatMap(res -> rrq.handleResponse(res)))
            .retry(2, ex -> 
                (ex instanceof BadToken)
                    && ((BadToken)ex).invalidate(tokens));
    }

    /** Internal */
    public Single<String> tokenFor (URI service)
    {
        return Single.fromCallable(() -> {
                //FPThreadUtil.logId("getting gss context");
                /* blocking */
                return fplus.gssClient()
                    .createContextHB("HTTP@" + service.getHost())
                    .orElseThrow(() -> new Exception("Can't get GSS context"));
            })
            .map(ctx -> new TokenRequest(service, ctx))
                /* buildRequest is blocking */
            .flatMap(req -> fetch(req.buildRequest())
                .flatMap(res -> req.handleResponse(res)))
            .subscribeOn(fplus.getScheduler())
            /* fetch moves calls below here to the http thread pool */
            .map(res -> res.ifOk()
                .flatMap(r -> r.getBodyObject())
                .orElseThrow(() -> new Exception("Invalid token response")))
            .map(o -> o.getString("token"));
    }

    private Single<JsonResponse> fetch (SimpleHttpRequest req)
    {
        //FPThreadUtil.logId("fetch called");
        //final var context = HttpCacheContext.create();
        return Single.<SimpleHttpResponse>create(obs ->
                async_client.execute(req, //context,
                    new FutureCallback<SimpleHttpResponse>() {
                        public void completed (SimpleHttpResponse res) {
                            //FPThreadUtil.logId("fetch success");
                            //context.getCacheResponseStatus(),
                            obs.onSuccess(res);
                        }

                        public void failed (Exception ex) {
                            //FPThreadUtil.logId("fetch failure");
                            obs.onError(ex);
                        }

                        public void cancelled () {
                            obs.onError(new Exception("HTTP future cancelled"));
                        }
                    }))
            //.doOnSuccess(res -> {
            //    FPThreadUtil.logId("handling fetch response");
            //    log.info("Fetch response {}: {}", req.getUri(), res.getCode());
            //})
            .map(res -> new JsonResponse(res));
    }
}

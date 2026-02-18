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
import org.apache.hc.client5.http.impl.cache.CacheConfig;
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

import org.eclipse.jetty.websocket.api.Callback;
import org.eclipse.jetty.websocket.api.Session;
import org.eclipse.jetty.websocket.api.util.WSURI;
import org.eclipse.jetty.websocket.client.WebSocketClient;

import org.json.*;

import io.reactivex.rxjava3.core.*;
import io.reactivex.rxjava3.disposables.*;
import io.reactivex.rxjava3.subjects.*;

import uk.co.amrc.factoryplus.client.*;
import uk.co.amrc.factoryplus.gss.*;
import uk.co.amrc.factoryplus.util.Duplex;

/** HTTP (REST) client.
 */
public class FPHttpClient {
    private static final Logger log = LoggerFactory.getLogger(FPHttpClient.class);

    private FPServiceClient fplus;
    private FPDiscovery discovery;

    private CloseableHttpAsyncClient async_client;
    private RequestCache<URI, String> tokens;

    private WebSocketClient ws_client;

    /** Internal; construct via {@link FPServiceClient}. */
    public FPHttpClient (FPServiceClient fplus)
    {
        this.fplus = fplus;

        CacheConfig cache_config = CacheConfig.custom()
            .setSharedCache(false)
            .build();

        tokens = new RequestCache<URI, String>(this::tokenFor);

        final IOReactorConfig ioReactorConfig = IOReactorConfig.custom()
            .setSoTimeout(Timeout.ofSeconds(5))
            .build();

        async_client = CachingHttpAsyncClients.custom()
            .setCacheConfig(cache_config)
            .setIOReactorConfig(ioReactorConfig)
            .build();

        ws_client = new WebSocketClient();
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
        /* This can throw if the directory url is missing, so don't call
         * in the constructor. */
        this.discovery = fplus.discovery();

        //FPThreadUtil.logId("Running async HTTP client");
        async_client.start();

        /* grr */
        try {
            ws_client.start();
        }
        catch (Exception e) {
            throw new ServiceConfigurationError("Cannot start WebSocket client", e);
        }
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
    public <Res> Single<Res> execute (ResolvableRequest<Res> req)
    {
        //FPThreadUtil.logId("execute called");
        return discovery
            .get(req.getService())
            .flatMap(base -> tokens.get(base)
                .map(tok -> req.resolveWith(base, tok)))
            .flatMap(rrq -> rrq.perform(this))
            .retry(2, ex -> 
                (ex instanceof BadToken)
                    && ((BadToken)ex).invalidate(tokens));
    }

    /** Internal */
    public Single<String> tokenFor (URI service)
    {
        return Single.fromSupplier(() -> {
                //FPThreadUtil.logId("getting gss context");
                /* blocking */
                return fplus.gssClient()
                    .createContextHB("HTTP@" + service.getHost())
                    .orElseThrow();
            })
            .map(ctx -> new TokenRequest(service, ctx))
                /* perform is blocking */
            .flatMap(req -> req.perform(this))
            .subscribeOn(fplus.getScheduler())
            /* fetch moves calls below here to the http thread pool */
            .map(res -> res.ifOk()
                .flatMap(r -> r.getBodyObject())
                .orElseThrow(() -> new Exception("Invalid token response")))
            .map(o -> o.getString("token"));
    }

    /** Opens a WebSocket.
     *
     * The sending side of the Duplex will send text msgs to the WS.
     * Received text msgs are emitted by the receiving side. Received
     * binary msgs will be ignored.
     *
     * Completing the send side will close the WS. An error emitted to
     * the send side will close the WS and then reflect the error to the
     * receiving side. 
     *
     * The send side relies on the Rx contract that onNext is called in
     * a serial fashion. Failure to respect this will cause Jetty WS
     * errors.
     *
     * @param uri URI of the WS to open
     */
    public Single<TextWebsocket> textWebsocket (URI uri)
    {
        return Single.create(obs -> {
            var ws_uri = WSURI.toWebsocket(uri);
            var ep = new TextWebsocket.Endpoint();

            var cf = this.ws_client.connect(ep, ws_uri);

            obs.setDisposable(Disposable.fromFuture(cf));
            cf.whenComplete((ok, err) -> {
                if (ok != null) 
                    obs.onSuccess(ep.getDuplex());
                else
                    obs.tryOnError(err);
            });
        });
    }

    /** Opens a F+ WebSocket.
     *
     * The path will be resolved relative to the service base URI. Once
     * the WS has opened, the F+ authentication exchange will be carried
     * out. */
    public Single<TextWebsocket> authWebsocket (UUID service, String path)
    {
        return this.execute(new WsRequest(service, path));
    }

    public Single<SimpleHttpResponse> fetch (SimpleHttpRequest req)
    {
        //FPThreadUtil.logId("fetch called");
        return Single.<SimpleHttpResponse>create(obs -> {
            //final var context = HttpCacheContext.create();
            async_client.execute(req, //context,
                new FutureCallback<SimpleHttpResponse>() {
                    public void completed (SimpleHttpResponse res) {
                        //FPThreadUtil.logId("fetch success");
                        String uri = "???";
                        try { uri = req.getUri().toString(); }
                        catch (Exception e) { }
                        //log.info("Cache {} ({}) for {}",
                        //    context.getCacheResponseStatus(), res.getCode(), uri);
                        obs.onSuccess(res);
                    }

                    public void failed (Exception ex) {
                        //FPThreadUtil.logId("fetch failure");
                        obs.onError(ex);
                    }

                    public void cancelled () {
                        obs.onError(new Exception("HTTP future cancelled"));
                    }
                });
        });
    }
}

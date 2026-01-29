/* 
 * Factory+ Java client library.
 * Base class for JSON HTTP requests.
 * Copyright 2026 University of Sheffield AMRC.
 */

package uk.co.amrc.factoryplus.http;

import org.apache.hc.client5.http.async.methods.SimpleHttpRequest;
import org.apache.hc.client5.http.async.methods.SimpleHttpResponse;

import io.reactivex.rxjava3.core.Single;

abstract class JsonRequest 
    extends PerformableRequest<SimpleHttpRequest, SimpleHttpResponse, JsonResponse>
{
    FPHttpClient client;

    public JsonRequest (FPHttpClient client)
    {
        this.client = client;
    }

    @Override
    protected Single<SimpleHttpResponse> fetch (SimpleHttpRequest req)
    {
        return client.fetch(req);
    }

    @Override
    protected JsonResponse translateResponse (SimpleHttpResponse res)
    {
        return new JsonResponse(res);
    }
}

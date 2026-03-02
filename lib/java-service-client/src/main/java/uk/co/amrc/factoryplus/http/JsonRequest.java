/* 
 * Factory+ Java client library.
 * Base class for JSON HTTP requests.
 * Copyright 2026 University of Sheffield AMRC.
 */

package uk.co.amrc.factoryplus.http;

import org.apache.hc.client5.http.async.methods.SimpleHttpRequest;
import org.apache.hc.client5.http.async.methods.SimpleHttpResponse;

import io.reactivex.rxjava3.core.Single;

abstract class JsonRequest implements PerformableRequest<JsonResponse>
{
    public Single<JsonResponse> perform (FPHttpClient client)
    {
        return Single.fromSupplier(this::buildRequest)
            .flatMap(client::fetch)
            .map(JsonResponse::new)
            .flatMap(this::handleJson);
    }

    protected abstract SimpleHttpRequest buildRequest () throws Throwable;

    protected Single<JsonResponse> handleJson (JsonResponse res)
        throws Throwable
    {
        return Single.just(res);
    }

}

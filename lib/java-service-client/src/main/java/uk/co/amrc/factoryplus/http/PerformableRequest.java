/* 
 * Factory+ Java client library.
 * Base class for HTTP requests ready to perform.
 * Copyright 2026 University of Sheffield AMRC.
 */

package uk.co.amrc.factoryplus.http;

import java.util.function.Function;

import io.reactivex.rxjava3.core.Single;

abstract class PerformableRequest<Req, Res, Out>
{
    public PerformableRequest ()
    {
    }

    public Single<Out> perform ()
        throws Throwable
    {
        return this.fetch(this.buildRequest())
            .map(res -> this.translateResponse(res))
            .flatMap(res -> this.handleResponse(res));
    }

    protected abstract Single<Res> fetch (Req r) throws Throwable;
    protected abstract Req buildRequest () throws Throwable;
    protected abstract Out translateResponse (Res res) throws Throwable;
    protected abstract Single<Out> handleResponse (Out res) throws Throwable;
}

/* 
 * Factory+ Java client library.
 * Base class for HTTP requests ready to perform.
 * Copyright 2026 University of Sheffield AMRC.
 */

package uk.co.amrc.factoryplus.http;

import java.util.function.Function;

import io.reactivex.rxjava3.core.Single;

interface PerformableRequest<Res>
{
    public Single<Res> perform (FPHttpClient client);
}

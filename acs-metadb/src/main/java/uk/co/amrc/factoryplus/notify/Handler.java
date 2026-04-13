/*
 * Factory+ service api
 * notify/v2 handler interface
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import io.reactivex.rxjava3.core.Observable;

import io.vavr.collection.*;

public interface Handler<T>
{
    Observable<T> handle (Session sess, Map<String, String> args);
}

/*
 * Factory+ service api
 * SEARCH provider
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import java.util.function.Supplier;

import io.vavr.Tuple2;
import io.vavr.collection.Map;
import io.vavr.control.Option;

import io.reactivex.rxjava3.core.Observable;

public record SearchProvider (
    Observable<SearchUpdate> updates,
    Observable<Boolean> acl)
{
}


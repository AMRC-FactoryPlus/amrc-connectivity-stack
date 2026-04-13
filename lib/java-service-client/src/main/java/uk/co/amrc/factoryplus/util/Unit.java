/*
 * Factory+ service client
 * Unit class
 * Copyright 2026 University of Sheffield AMRC
 */

/* Neither RxJava nor Vavr provide this class; I don't quite understand
 * why not. There is no obvious alternative beyond using Object and
 * null, and losing type-safety. RxJava has Completable to handle the
 * cases that might otherwise be Single<Unit>, but nothing to handle
 * Observable<Unit> or Flowable<Unit>. */

package uk.co.amrc.factoryplus.util;

public final class Unit
{
    public static final Unit UNIT = new Unit();

    private Unit () { }
}

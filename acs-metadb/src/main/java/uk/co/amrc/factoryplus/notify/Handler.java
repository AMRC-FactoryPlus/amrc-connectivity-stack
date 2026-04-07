/*
 * Factory+ service api
 * notify/v2 handler interface
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import io.vavr.collection.*;

public interface Handler<T>
{
    T handle (Session sess, Map<String, String> args);
}

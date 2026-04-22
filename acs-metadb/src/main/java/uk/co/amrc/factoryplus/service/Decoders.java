/*
 * Factory+ service api
 * Utility functions for decoding from strings
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.service;

import java.io.StringReader;
import java.util.UUID;

import jakarta.json.*;

import io.vavr.control.*;

public final class Decoders {
    public static UUID parseUUIDOrError (String uuid)
    {
        /* Initial length check as UUID.fromString is too lenient. */
        if (uuid.length() != 36)
            throw new IllegalArgumentException("UUID is not 36 chars long");
        return UUID.fromString(uuid);
    }

    public static Option<UUID> parseUUID (String uuid)
    {
        return Try.of(() -> parseUUIDOrError(uuid))
            .toOption();
    }
    
    /* This will silently ignore trailing garbage. I think this could be
     * cured by using JsonParser instead but it's not straightforward. */
    public static Try<JsonValue> tryReadJson (String json)
    {
        var sr = new StringReader(json);
        var jr = Json.createReader(sr);

        return Try.of(jr::readValue)
            .andFinally(jr::close);
    }

    public static Option<JsonValue> readJson (String json)
    {
        return tryReadJson(json).toOption();
    }
    public static JsonValue readJsonOrError (String json)
    {
        return tryReadJson(json).get();
    }
}

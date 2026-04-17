/*
 * Factory+ service api
 * notify/v2 response object
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import java.util.UUID;

import jakarta.json.*;

import io.vavr.control.Option;

public record Response (
    int status, Option<UUID> etag, Option<JsonValue> body)
{
    public static Response ok (JsonValue body)
    {
        return new Response(200, Option.none(), Option.some(body));
    }
    public static Response ok (JsonValue body, UUID etag)
    {
        return new Response(200, Option.some(etag), Option.some(body));
    }
    public static Response status (int status)
    {
        return new Response(status, Option.none(), Option.none());
    }

    public JsonValue toJson ()
    {
        var obj = Json.createObjectBuilder()
            .add("status", status);
        etag.peek(e -> obj.add("headers",
            Json.createObjectBuilder()
                .add("etag", e.toString())
                .build()));
        body.peek(b-> obj.add("body", b));
        return obj.build();
    }
}

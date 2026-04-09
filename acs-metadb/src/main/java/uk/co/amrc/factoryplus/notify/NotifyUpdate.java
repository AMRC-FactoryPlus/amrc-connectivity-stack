/*
 * Factory+ service api
 * notify/v2 update message
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import java.util.UUID;

import jakarta.json.*;

public record NotifyUpdate (int status, JsonObject content)
{
    public static NotifyUpdate empty (int status)
    {
        return new NotifyUpdate(status, JsonValue.EMPTY_JSON_OBJECT);
    }

    public static NotifyUpdate ok (boolean initial, JsonObject content)
    {
        return new NotifyUpdate(initial ? 201 : 200, content);
    }

    /* Args reversed to simplify zipWith */
    public static NotifyUpdate ofResponse (Response res, boolean initial)
    {
        /* Special case where we know the response cannot change */
        if (res.status() == 410)
            return NotifyUpdate.empty(404);

        return NotifyUpdate.ok(initial,
            Json.createObjectBuilder()
                .add("response", res.toJson())
                .build());
    }

    public boolean ok () { return status < 400; }

    public JsonValue toJson (UUID session)
    {
        var obj = Json.createObjectBuilder(content)
            .add("status", status)
            .add("uuid", session.toString());
        return obj.build();
    }
}


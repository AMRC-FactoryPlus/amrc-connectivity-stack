/*
 * Factory+ service api
 * notify/v2 update message
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import java.util.UUID;

import jakarta.json.*;

import io.vavr.collection.*;

public record NotifyUpdate (int status, Map<String, JsonValue> content)
{
    public static NotifyUpdate empty (int status)
    {
        return new NotifyUpdate(status, HashMap.empty());
    }
    public static NotifyUpdate ofResponse (Response res, boolean initial)
    {
        return new NotifyUpdate(initial ? 201 : 200, 
            HashMap.of("response", res.toJson()));
    }

    public boolean ok () { return status < 400; }

    public JsonValue toJson (UUID session)
    {
        var obj = Json.createObjectBuilder()
            .add("status", status)
            .add("uuid", session.toString());
        content.forEach(obj::add);
        return obj.build();
    }
}


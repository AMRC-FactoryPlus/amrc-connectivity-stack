/*
 * Factory+ service api
 * notify/v2 request object
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import java.util.UUID;

import jakarta.json.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public record Request (UUID uuid, Request.Method method, JsonObject body)
{
    private static final Logger log = LoggerFactory.getLogger(Request.class);

    public enum Method {
        Unknown,
        CLOSE,
        WATCH,
        SEARCH,
    };

    /* This throws random errors but all indicate a bad request */
    public static Request fromJson (JsonValue json) throws Throwable
    {
        var obj = (JsonObject)json;
        var uuid = UUID.fromString(obj.getString("uuid"));

        Method method;
        try { method = Method.valueOf(obj.getString("method")); }
        catch (Throwable e) { method = Method.Unknown; }

        return new Request(uuid, method, obj);
    }

    /* XXX messy */
    public boolean validate ()
    {
        switch (method) {
            case CLOSE:
                return true;
            case WATCH:
                if (!body.containsKey("request"))
                    return false;
                return true;
            case SEARCH:
                if (!body.containsKey("parent"))
                    return false;
                return true;
            default:
                return false;
        }
    }

}

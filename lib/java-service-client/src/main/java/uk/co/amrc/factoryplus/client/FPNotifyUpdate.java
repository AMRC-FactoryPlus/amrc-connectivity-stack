/*
 * Factory+ Java service client
 * Notify/v2 update
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.client;

import java.util.Map;
import java.util.UUID;

import org.json.*;

public class FPNotifyUpdate
{
    private UUID uuid;
    private int status;
    private Map<String, Object> content;

    private FPNotifyUpdate (UUID uuid, int status, Map<String, Object> content)
    {
        this.uuid = uuid;
        this.status = status;
        this.content = content;
    }

    public UUID getUUID () { return uuid; }
    public int getStatus () { return status; }

    public boolean isOK () { return status < 300; }

    /* XXX We need the request type to decode the content. */
    public Map<String, Object> content () { return content; }

    public String toString ()
    {
        return "UPDATE [" + uuid + "] (" + status + "): "
            + content.toString();
    }

    public static FPNotifyUpdate ofJSON (Object value) throws Throwable
    {
        var json = (JSONObject)value;
        var uuid = UUID.fromString(json.getString("uuid"));
        var status = json.getInt("status");

        /* XXX We could strip out the keys we've used here, but that's
         * more trouble than it's worth... */
        var content = json.toMap();

        return new FPNotifyUpdate(uuid, status, content);
    }
}

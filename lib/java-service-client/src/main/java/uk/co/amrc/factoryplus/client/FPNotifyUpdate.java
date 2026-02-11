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
    private JSONObject content;

    private FPNotifyUpdate (UUID uuid, int status, JSONObject content)
    {
        this.uuid = uuid;
        this.status = status;
        this.content = content;
    }

    public UUID getUUID () { return uuid; }
    public int getStatus () { return status; }

    public boolean isOK () { return status < 300; }

    /* XXX We need the request type to decode the content. */
    public JSONObject getContent () { return content; }

    public String toString ()
    {
        return "UPDATE [" + uuid + "] (" + status + "): "
            + content.toString();
    }

    public static FPNotifyUpdate ofJSON (String json) throws JSONException
    {
        var content = new JSONObject(json);

        var uuid = UUID.fromString(content.getString("uuid"));
        var status = content.getInt("status");

        content.remove("uuid");
        content.remove("status");

        return new FPNotifyUpdate(uuid, status, content);
    }
}

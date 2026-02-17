/*
 * Factory+ Java service client
 * Notify/v2 request
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.client;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.json.*;

public abstract class FPNotifyRequest
{
    JSONObject toJSONWithUUID (UUID uuid)
    {
        var json = this.toJSON();
        json.put("uuid", uuid.toString());
        return json;
    }

    /* Create a new JSONObject representing this request.
     * The object will be subsequently modified.
     */
    protected abstract JSONObject toJSON ();

    public static FPNotifyRequest.Watch watch (String path)
    {
        return new Watch(path);
    }

    public static FPNotifyRequest.Search search (String path)
    {
        return new Search(path, Optional.empty());
    }

    static JSONObject close (UUID uuid)
    {
        return new JSONObject()
            .put("method", "CLOSE")
            .put("uuid", uuid.toString());
    }

    public static class Watch extends FPNotifyRequest
    {
        private String url;

        Watch (String url)
        {
            this.url = url;
        }

        public String toString ()
        {
            return "WATCH " + url;
        }

        protected JSONObject toJSON ()
        {
            return new JSONObject()
                .put("method", "WATCH")
                .put("request", new JSONObject()
                    .put("url", this.url));
        }
    }

    public static class Search extends FPNotifyRequest
    {
        private String parent;
        private Optional<Map<String, Object>> filter;

        Search (String parent, Optional<Map<String, Object>> filter)
        {
            this.parent = parent;
            this.filter = filter;
        }

        public String toString ()
        {
            return "SEARCH " + parent
                + (filter.isPresent() ? " filter " + filter.toString() : "");
        }

        public Search withFilter (Map<String, Object> filter)
        {
            return new Search(this.parent, Optional.of(filter));
        }

        protected JSONObject toJSON ()
        {
            var json = new JSONObject()
                .put("method", "SEARCH")
                .put("parent", parent);
            if (filter.isPresent())
                json.put("filter", new JSONObject(filter.get()));
            return json;
        }
    }
}

/*
 * Factory+ Java service client
 * Notify/v2 request
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.client;

import java.lang.StringBuilder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

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

    public static FPNotifyRequest.Watch watch (Object... args)
    {
        return new Watch(urljoin(args));
    }

    public static FPNotifyRequest.Search search (Object... args)
    {
        return new Search(urljoin(args) + "/", Optional.empty());
    }

    static JSONObject close (UUID uuid)
    {
        return new JSONObject()
            .put("method", "CLOSE")
            .put("uuid", uuid.toString());
    }

    /* This is ridiculous. Neither the JRE nor Jetty have a correct
     * equivalent to encodeURIComponent. */
    private static final String HEX = "0123456789abcdef";

    private static String encodeURIComponent (String str)
    {
        var bytes = str.getBytes(StandardCharsets.UTF_8);
        var builder = new StringBuilder(bytes.length);

        for (var c : bytes) {
            var safe =
                c >= 'a' ? c <= 'z' || c == '~' :
                c >= 'A' ? c <= 'Z' || c == '_' :
                c >= '0' ? c <= '9' :
                c == '-' || c == '.';

            if (safe)
                builder.append((char)c);
            else
                builder.append('%')
                    .append(HEX.charAt(c >> 4 & 0xf))
                    .append(HEX.charAt(c & 0xf));
        }

        return builder.toString();
    }

    private static String urljoin (Object... args)
    {
        return Arrays.stream(args)
            .map(Object::toString)
            .map(FPNotifyRequest::encodeURIComponent)
            .collect(Collectors.joining("/"));
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

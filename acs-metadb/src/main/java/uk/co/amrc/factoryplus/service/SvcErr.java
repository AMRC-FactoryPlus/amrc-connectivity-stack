/*
 * Factory+ service API
 * Service exceptions
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.service;

import java.util.Map;

import jakarta.json.*;

public class SvcErr extends Error
{
    public SvcErr (String msg)
    {
        super(msg);
    }

    public static abstract class Client extends SvcErr
    {
        public Client (String msg)
        {
            super(msg);
        }

        public abstract int statusCode ();

        public JsonValue buildJson ()
        {
            var obj = Json.createObjectBuilder()
                .add("message", getMessage());
            extendJson(obj);
            return obj.build();
        }
        protected void extendJson (JsonObjectBuilder obj) { }

        public Map<String, String> buildHeaders ()
        {
            return Map.of();
        }
    }
    public static class AuthFailed extends Client
    {
        public AuthFailed (String why) {
            super("Authentication failed: " + why);
        }
        public int statusCode () { return 401; }
        public Map<String, String> buildHeaders ()
        {
            /* This is not a correct reflection of the auth we accept,
             * but this is what the F+ services have always sent. If we
             * admit to accepting Negotiate auth then Windows browsers
             * try to authenticate via SSPI and create a problem. */
            return Map.of("WWW-Authenticate", "Basic realm=\"Factory+\"");
        }
    }
    public static class Forbidden extends Client
    {
        public Forbidden ()
        {
            super("Access denied");
        }

        public int statusCode () { return 403; }
    }
    public static class NotFound extends Client
    {
        public NotFound (String res)
        {
            super("Resource not found: " + res);
        }

        public int statusCode () { return 404; }
    }
    public static class InvalidName extends Client
    {
        public InvalidName (String name)
        {
            super("Invalid resource name: " + name);
        }

        public int statusCode () { return 410; }
    }
    public static class BadJson extends Client
    {
        public BadJson (JsonValue val)
        {
            super("Unexpected JSON value: " + val.toString());
        }

        public int statusCode () { return 422; }
    }
}

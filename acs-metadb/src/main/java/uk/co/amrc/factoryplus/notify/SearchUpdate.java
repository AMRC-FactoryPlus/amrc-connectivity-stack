/*
 * Factory+ service api
 * SEARCH notify update internal structure
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import jakarta.json.*;

import io.vavr.collection.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public interface SearchUpdate
{
    JsonObject content ();

    default Iterable<SearchUpdate> diffFrom (SearchUpdate prev)
    {
        return List.of(this);
    }

    default NotifyUpdate toUpdate (boolean initial)
    {

        return NotifyUpdate.ok(initial, content());
    }

    static SearchUpdate noAccess () { return new Empty(403); }
    static SearchUpdate notFound () { return new Empty(404); }
    static SearchUpdate invalid () { return new Invalid(); }

    static SearchUpdate full (Map<String, Response> children)
    {
        return new Full(children);
    }
    static SearchUpdate child (String name, Response response)
    {
        return new Child(name, response);
    }

    public record Empty (int status) implements SearchUpdate
    {
        public JsonObject content ()
        {
            return Json.createObjectBuilder()
                .add("response", Response.status(status).toJson())
                .build();
        }
    }

    /* This is for situations where the notify endpoint doesn't exist. */
    public record Invalid () implements SearchUpdate
    {
        public JsonObject content () { return JsonValue.EMPTY_JSON_OBJECT; }

        public NotifyUpdate toUpdate (boolean initial)
        {
            return NotifyUpdate.empty(404);
        }
    }

    public record Full (Map<String, Response> children) implements SearchUpdate
    {
        private static final Logger log = LoggerFactory.getLogger(Full.class);

        public JsonObject content ()
        {
            var obj = Json.createObjectBuilder();
            children.forEach((k, r) -> obj.add(k, r.toJson()));
            return Json.createObjectBuilder()
                .add("children", obj.build())
                .add("response", Response.status(204).toJson())
                .build();
        }

        public Iterable<SearchUpdate> diffFrom (SearchUpdate upd)
        {
            if (!(upd instanceof Full))
                return List.of(this);
            var prev = (Full)upd;

            var updated = this.children.toStream()
                .reject(prev.children::contains)
                .map(e -> SearchUpdate.child(e._1(), e._2()));

            var removed = prev.children.keySet()
                .diff(this.children.keySet())
                .toStream()
                .map(n -> SearchUpdate.child(n, Response.status(404)));

            return Stream.concat(updated, removed);
        }
    }

    public record Child (String name, Response response) implements SearchUpdate
    {
        public JsonObject content ()
        {
            return Json.createObjectBuilder()
                .add("child", name)
                .add("response", response.toJson())
                .build();
        }
    }
}

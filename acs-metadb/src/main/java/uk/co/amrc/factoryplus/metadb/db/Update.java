/*
 * Factory+ metadata database
 * Dataflow update
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.UUID;

import io.vavr.control.Option;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;

public interface Update
{
    public record Config (
            UUID app,
            UUID obj,
            Option<ConfigEntry.Value> value)
        implements Update
    {
        public static Config ofQuerySolution (QuerySolution sol)
        {
            var val = Option.some(sol)
                .filter(s -> s.contains("value"))
                .map(ConfigEntry.Value::ofQuerySolution);
            return new Update.Config(
                Util.decodeLiteral(sol.get("appU"), UUID.class),
                Util.decodeLiteral(sol.get("objU"), UUID.class),
                val);
        }
    }

    public class Class implements Update { }
}

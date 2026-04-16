/*
 * Factory+ service API
 * Service ping result interface
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.providers;

import java.util.UUID;

import jakarta.json.*;

public record PingResult (
    UUID service, String version,
    String vendor, String application, String revision)
{
    public JsonObject toJson ()
    {
        return Json.createObjectBuilder()
            .add("service", service().toString())
            .add("version", version())
            .add("software", Json.createObjectBuilder()
                .add("vendor", vendor)
                .add("application", application)
                .add("revision", revision)
                .build())
            .build();
    }
}

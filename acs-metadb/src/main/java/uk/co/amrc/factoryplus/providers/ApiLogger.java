/*
 * Factory+ service API
 * API request logger
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.providers;

import jakarta.annotation.Priority;
import jakarta.ws.rs.container.*;
import jakarta.ws.rs.ext.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Provider @PreMatching @Priority(0)
public class ApiLogger implements ContainerRequestFilter, ContainerResponseFilter
{
    private static final Logger log = LoggerFactory.getLogger(ApiLogger.class);

    public void filter (ContainerRequestContext req)
    {
        log.info(">>> {} {}", req.getMethod(), req.getUriInfo().getPath());
    }

    public void filter (ContainerRequestContext req, ContainerResponseContext res)
    {
        log.info("<<< {} {}", res.getStatus(), res.getMediaType());
    }
}

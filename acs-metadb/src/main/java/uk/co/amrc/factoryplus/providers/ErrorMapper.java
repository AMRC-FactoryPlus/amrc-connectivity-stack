/*
 * Factory+ service API
 * Jakarta RS exception mapping
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.providers;

import jakarta.json.*;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;
import jakarta.ws.rs.ext.*;

import org.glassfish.hk2.api.MultiException;
import org.glassfish.jersey.server.spi.ResponseErrorMapper;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.service.SvcErr;

public class ErrorMapper
{
    public static final Logger log = LoggerFactory.getLogger(ErrorMapper.class);

    public static Response clientError (SvcErr.Client err)
    {
        /* XXX we should allow the error to include more fields here */
        log.info("Returning error: {}", err.toString());
        var json = err.buildJson();
        var res = Response.status(err.statusCode())
            .entity(json);
        err.buildHeaders().forEach(res::header);
        return res.build();
    }

    @Provider
    public static class CliErr implements ExceptionMapper<SvcErr.Client>
    {
        public Response toResponse (SvcErr.Client err)
        {
            return ErrorMapper.clientError(err);
        }
    }

    @Provider
    public static class REM implements ResponseErrorMapper
    {
        public Response toResponse (Throwable err)
        {
            if (err instanceof SvcErr.Client)
                return ErrorMapper.clientError((SvcErr.Client)err);

            /* These can be thrown by parameters injected into objects
             * (as opposed to method parameters). This causes the
             * correct response handling but we still get a warning in
             * the logs. */
            if (err instanceof MultiException) {
                var merr = (MultiException)err;
                for (var e : merr.getErrors()) {
                    var r = toResponse(e);
                    if (r != null)
                        return r;
                }
            }

            return null;
        }
    }
}

/*
 * Factory+ metadata database
 * Jakarta RS exception mapping
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb;

import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;
import jakarta.ws.rs.ext.*;

import org.glassfish.hk2.api.MultiException;
import org.glassfish.jersey.server.spi.ResponseErrorMapper;

public class ErrorMapper
{
    public static Response clientError (Err.ClientError err)
    {
        return Response.status(err.statusCode())
            .entity(err.getMessage() + "\r\n")
            .build();
    }

    @Provider
    public static class CliErr implements ExceptionMapper<Err.ClientError>
    {
        public Response toResponse (Err.ClientError err)
        {
            return ErrorMapper.clientError(err);
        }
    }

    @Provider
    public static class REM implements ResponseErrorMapper
    {
        public Response toResponse (Throwable err)
        {
            if (err instanceof Err.ClientError)
                return ErrorMapper.clientError((Err.ClientError)err);

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

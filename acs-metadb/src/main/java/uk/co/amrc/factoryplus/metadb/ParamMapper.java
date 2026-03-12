/* 
 * Factory+ metadata database
 * Jakarta parameter mapping
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb;

import java.lang.annotation.Annotation;
import java.lang.reflect.Type;
import java.util.UUID;

import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;
import jakarta.ws.rs.ext.*;

@Provider
public class ParamMapper implements ParamConverterProvider
{
    public static class UUIDMapper implements ParamConverter<UUID>
    {
        public UUID fromString (String value)
        {
            return Vocab.parseUUID(value)
                .orElseThrow(() -> new Err.InvalidName(value));
        }

        public String toString (UUID value)
        {
            return value.toString();
        }
    }

    @SuppressWarnings("unchecked")
    public <T> ParamConverter<T> getConverter(
        Class<T> rawType, Type genericType, Annotation[] annotations)
    {
        ParamConverter<?> rv = null;

        if (rawType.equals(UUID.class))
            rv = new UUIDMapper();

        return (ParamConverter<T>)rv;
    }
}

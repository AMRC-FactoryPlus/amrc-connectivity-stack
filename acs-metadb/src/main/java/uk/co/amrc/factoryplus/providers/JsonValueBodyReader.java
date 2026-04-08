/*
 * Factory+ service api
 * Replacement for parsson JsonValueBodyReader
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.providers;

import java.io.IOException;
import java.io.InputStream;
import java.lang.annotation.Annotation;
import java.lang.reflect.Type;
import java.nio.charset.*;

import jakarta.json.*;

import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;
import jakarta.ws.rs.ext.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/* The Parsson JsonValueBodyReader does not respect the encodings
 * specified on the media type, instead it attempt to guess a Unicode
 * encoding. This fails on single-character inputs. */
@Provider
@Consumes({"application/json", "*/*"})
public class JsonValueBodyReader implements MessageBodyReader<JsonValue>
{
    private static final Logger log = LoggerFactory.getLogger(JsonValueBodyReader.class);
    private final JsonReaderFactory rf = Json.createReaderFactory(null);

    private static final String PLUS_JSON = "+json";

    public JsonValueBodyReader ()
    {
        log.info("CONSTRUCT JsonValueBodyReader");
    }

    @Override
    public boolean isReadable (
        Class<?> aClass, Type gType, Annotation[] annots, MediaType mType)
    {
        log.info("isReadable: {}, {}", aClass, mType);

        if (!JsonValue.class.isAssignableFrom(aClass))
            return false;

        if (MediaType.APPLICATION_JSON_TYPE.isCompatible(mType))
            return true;

        if (mType.getSubtype().endsWith(PLUS_JSON))
            return true;

        return false;
    }

    @Override
    public JsonValue readFrom (
        Class<JsonValue> klass, Type gType, Annotation[] annots,
        MediaType mType, MultivaluedMap<String, String> headers,
        InputStream inputStream)
        throws IOException, WebApplicationException
    {
        var cparam = mType.getParameters()
            .getOrDefault("charset", "UTF-8");
        Charset charset;
        try {
            charset = Charset.forName(cparam);
        }
        catch (Throwable err) {
            log.info("Cannot find JSON charset", err);
            throw new WebApplicationException(
                "Cannot decode JSON using charset " + cparam, err, 415);
        }
        
        try (JsonReader reader = rf.createReader(inputStream, charset)) {
            return reader.readValue();
        }
    }
}

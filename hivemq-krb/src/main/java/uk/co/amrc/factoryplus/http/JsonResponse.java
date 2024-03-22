/* Factory+ Java client library.
 * JSON HTTP response.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus.http;

import java.util.Optional;

import org.apache.hc.client5.http.async.methods.SimpleHttpResponse;
import org.apache.hc.core5.http.ProtocolException;

import org.json.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** A reponse to an HTTP request.
 *
 * The response body is parsed from JSON and available as an object.
 */
public class JsonResponse
{
    private static final Logger log = LoggerFactory.getLogger(FPHttpClient.class);

    private SimpleHttpResponse response;
    private Optional<Object> body;

    /** Parse an HTTP response.
     *
     * If JSON parsing fails the response body will be returned as
     * empty.
     *
     * @param res The HTTP response to parse.
     */
    public JsonResponse (SimpleHttpResponse res)
    {
        response = res;
        //log.info("Parsing JSON response: {}", res.getCode());

        body = Optional.ofNullable(res.getBodyText())
            .filter(s -> !s.isEmpty())
            .map(json -> new JSONTokener(json))
            .flatMap(tok -> {
                try {
                    return Optional.of(tok.nextValue());
                }
                /* XXX Should we instead fake up an error response?
                 * Possibly a 6XX error code (client-side errors)? */
                catch (JSONException e) {
                    log.error("Error parsing JSON: {}", e.toString());
                    return Optional.<Object>empty();
                }
            });
    }

    public SimpleHttpResponse getResponse () { return response; }
    public int getCode () { return response.getCode(); }

    /** Was the response a success?
     *
     * @return Whether the response had a 2XX code.
     */
    public boolean ok ()
    {
        int code = getCode();
        return code >= 200 && code < 300;
    }

    /** Handle success using Optional.
     *
     * @return <code>this</code> iff the response was 2XX.
     */
    public Optional<JsonResponse> ifOk ()
    {
        return ok() ? Optional.of(this) : Optional.<JsonResponse>empty();
    }

    /** Fetches a header.
     *
     * @param name The header name.
     * @return The header value, if present.
     * @throws ProtocolException
     *  If there is more than one of the given header.
     */
    public Optional<String> getHeader (String name)
        throws ProtocolException
    {
        return Optional.ofNullable(response.getHeader(name))
            .map(h -> h.getValue());
    }

    /** Gets the parsed body.
     *
     * This will be a {@link JSONObject}, a {@link JSONArray}, or an
     * object representing a JSON scalar value.
     *
     * @return The parsed body.
     */
    public Optional<Object> getBody () { return body; }

    /** Did the response contain a (valid) body?
     *
     * @return Whether the body was present.
     */
    public boolean hasBody () { return body.isPresent(); }

    /* Java 11 sucks
    public <T> Optional<T> getBodyAs ()
    {
        return body
            .filter(o -> o instanceof T)
            .map(o -> (T)o);
    }
    */

    /** Gets the body as a JSONObject.
     *
     * @return The body if it was an object, otherwise an empty
     * Optional.
     */
    public Optional<JSONObject> getBodyObject ()
    {
        return body
            .filter(o -> o instanceof JSONObject)
            .map(o -> (JSONObject)o);
    }
    /** Gets the body as a JSONArray.
     *
     * @return The body if it was an array, otherwise an empty
     * Optional.
     */
    public Optional<JSONArray> getBodyArray ()
    {
        return body
            .filter(o -> o instanceof JSONArray)
            .map(o -> (JSONArray)o);
    }
}

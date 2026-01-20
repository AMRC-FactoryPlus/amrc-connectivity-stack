/* Factory+ Java client library.
 * HTTP request.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus.http;

import java.net.URI;
import java.util.UUID;
import java.util.function.UnaryOperator;

import org.apache.hc.core5.net.URIBuilder;
import org.json.JSONObject;

import io.reactivex.rxjava3.core.Single;

/** Represents a single request to a F+ service.
 *
 * An object of this class is used to build up the definition of a
 * request before fetching it.
 */
public class FPHttpRequest {
    /* XXX ResolvedRequest needs friend access */
    private FPHttpClient client;
    UUID service;
    String method;
    String path;
    JSONObject body;

    /** Internal; construct via {@link FPHttpClient}. */
    public FPHttpRequest (FPHttpClient client, UUID service, String method)
    {
        this.client = client;
        this.service = service;
        this.method = method;
    }

    /** Sets the path.
     *
     * This is relative to the resolved service URL.
     *
     * @param path The complete path.
     * @return <code>this</code>.
     */
    public FPHttpRequest withPath (String path)
    {
        this.path = path;
        return this;
    }

    /** Builds the path using a {@link URIBuilder}.
     *
     * @param build A function to configure the <code>URIBuilder</code>.
     * @return <code>this</code>.
     */
    public FPHttpRequest withURIBuilder (UnaryOperator<URIBuilder> build)
    {
        var dot = new URIBuilder()
            .setPathSegmentsRootless(".");
        this.path = build.apply(dot).toString();
        return this;
    }

    /** Sets the body of the request.
     *
     * This will be sent as JSON.
     *
     * @param body The body to send.
     * @return <code>this</code>.
     */
    public FPHttpRequest withBody (JSONObject body)
    {
        this.body = body;
        return this;
    }

    /** Internal */
    public ResolvedRequest resolveWith (URI base, String token)
    {
        return new ResolvedRequest(this, base, token);
    }

    /** Perform the request and return the response.
     *
     * The returned Single resolves with the response. HTTP-level errors
     * still cause the Single to return success, so the response can be
     * examined.
     *
     * The body of the response will be parsed from JSON.
     *
     * @return A promise to the response.
     */
    public Single<JsonResponse> fetch ()
    {
        return client.execute(this);
    }
}

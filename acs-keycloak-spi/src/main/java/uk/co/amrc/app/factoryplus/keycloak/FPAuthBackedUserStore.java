/* ACS Keycloak SPI
 * HTTP-backed FactoryPlusUserStore implementation.
 *
 * Phase 2 implementation: uses bare java.net.http.HttpClient against
 * the Factory+ auth service. No Kerberos here - that's Phase 4, which
 * will swap this out (or extend it) to use lib/java-service-client's
 * FPGssClientKeytab for SPNEGO authentication. The interface seam
 * (FactoryPlusUserStore) absorbs that change without touching the
 * provider.
 *
 * JSON parsing uses Jackson (which Keycloak ships in its runtime
 * classpath) rather than org.json so we don't have to bundle a JSON
 * library into the SPI jar.
 *
 * HTTP contract this expects from the auth service (Phase 3 implements
 * these endpoints in acs-auth):
 *
 *   GET /v2/principal/{uuid}
 *       200 with { uuid, name, email? } when the principal exists
 *       404 when no principal has that UUID
 *
 *   GET /v2/principal?name={name}
 *       200 with { uuid, name, email? } when a principal has that name
 *       404 when no principal has that name
 *
 *   GET /v2/principal?email={email}
 *       200 with { uuid, name, email } when a principal has that email
 *       404 when no principal has that email
 *
 * In all responses 'name' is the F+ principal name (corresponds to
 * Keycloak's username) and 'email' is optional (service principals
 * have none). Any 5xx, malformed JSON, or transport failure is
 * surfaced as FactoryPlusAuthException.
 *
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;

public class FPAuthBackedUserStore implements FactoryPlusUserStore {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final URI baseUrl;
    private final Duration timeout;
    private final HttpClient http;

    public FPAuthBackedUserStore(URI baseUrl, Duration timeout) {
        this.baseUrl = baseUrl;
        this.timeout = timeout;
        this.http = HttpClient.newBuilder()
            .connectTimeout(timeout)
            .build();
    }

    @Override
    public Optional<FactoryPlusUser> findByUuid(String uuid) {
        return doLookup("/v2/principal/" + encode(uuid));
    }

    @Override
    public Optional<FactoryPlusUser> findByUsername(String username) {
        return doLookup("/v2/principal?name=" + encode(username));
    }

    @Override
    public Optional<FactoryPlusUser> findByEmail(String email) {
        return doLookup("/v2/principal?email=" + encode(email));
    }

    private Optional<FactoryPlusUser> doLookup(String path) {
        URI uri = baseUrl.resolve(path);
        HttpRequest req = HttpRequest.newBuilder(uri)
            .timeout(timeout)
            .header("Accept", "application/json")
            .GET()
            .build();

        HttpResponse<String> res;
        try {
            res = http.send(req, HttpResponse.BodyHandlers.ofString());
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new FactoryPlusAuthException("Interrupted calling " + uri, e);
        }
        catch (IOException e) {
            throw new FactoryPlusAuthException("Transport failure calling " + uri, e);
        }

        int status = res.statusCode();
        if (status == 404) {
            return Optional.empty();
        }
        if (status < 200 || status >= 300) {
            throw new FactoryPlusAuthException(
                "F+ auth returned " + status + " for " + uri);
        }

        try {
            JsonNode root = MAPPER.readTree(res.body());
            if (!root.isObject() || !root.hasNonNull("uuid") || !root.hasNonNull("name")) {
                throw new FactoryPlusAuthException(
                    "Malformed response from " + uri + " (missing required fields)");
            }
            JsonNode emailNode = root.get("email");
            String email = (emailNode == null || emailNode.isNull())
                ? null
                : emailNode.asText();
            return Optional.of(new FactoryPlusUser(
                root.get("uuid").asText(),
                root.get("name").asText(),
                email));
        }
        catch (JsonProcessingException e) {
            throw new FactoryPlusAuthException(
                "Malformed response from " + uri, e);
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}

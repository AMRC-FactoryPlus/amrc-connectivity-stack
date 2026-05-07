/* ACS Keycloak SPI
 * Outbound SPNEGO authentication for F+ HTTP calls.
 *
 * Looks up Kerberos credentials from a keytab via JAAS' Krb5LoginModule
 * and produces base64-encoded SPNEGO initial tokens for a given target
 * URL. The store layer injects these tokens into 'Authorization:
 * Negotiate <token>' headers.
 *
 * Concrete behaviour requires a Kerberos KDC and a valid keytab so it
 * cannot be unit-tested without serious infrastructure. The interface
 * lets the rest of the SPI be tested with a mock; a manual
 * verification recipe (Phase 11) covers the real path against the
 * cluster's KDC.
 *
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import java.net.URI;

/**
 * Minimal interface so the rest of the SPI can be wired against a mock
 * in tests. Production implementation is {@link JaasKerberosAuthenticator}.
 */
public interface KerberosAuthenticator {

    /**
     * Build a SPNEGO initial token suitable for the
     * {@code Authorization: Negotiate <token>} header when calling the
     * given URL.
     *
     * <p>The target service principal is derived from the URL's host
     * as {@code HTTP/<host>} (Kerberos hostbased-service form), which
     * is the convention the Factory+ auth service follows.
     *
     * @param target the URL we're about to call
     * @return base64-encoded GSS token
     * @throws FactoryPlusAuthException if credential acquisition or
     *     SPNEGO context initiation fails
     */
    String spnegoTokenFor(URI target);
}

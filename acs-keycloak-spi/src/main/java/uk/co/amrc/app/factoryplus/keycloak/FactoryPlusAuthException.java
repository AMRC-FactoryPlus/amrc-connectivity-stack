/* ACS Keycloak SPI
 * Thrown when the Factory+ auth service can't be reached, returns an
 * unexpected status, or sends back a malformed response. The provider
 * lets these propagate so Keycloak surfaces them in the federation
 * chain (next federation gets a chance, or the login fails) rather than
 * silently returning empty results that would look like "user not
 * found".
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

public class FactoryPlusAuthException extends RuntimeException {

    public FactoryPlusAuthException(String message) {
        super(message);
    }

    public FactoryPlusAuthException(String message, Throwable cause) {
        super(message, cause);
    }
}

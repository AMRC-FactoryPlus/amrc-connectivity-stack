/* ACS Keycloak SPI
 * Raised when Factory+ Auth refuses a request with 403.
 *
 * A subtype of FactoryPlusAuthException, so every existing catch site
 * behaves exactly as before. It exists so the cross-realm resolve can
 * tell "the home cluster has not granted us ReadKrb" - a standing
 * configuration state - apart from "the home cluster is having a bad
 * minute". Both are fatal to the login, but only the former is worth
 * caching: see FPAuthBackedUserStore.resolveCrossRealm.
 *
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

public class FactoryPlusAccessDeniedException extends FactoryPlusAuthException {

    public FactoryPlusAccessDeniedException(String message) {
        super(message);
    }

    public FactoryPlusAccessDeniedException(String message, Throwable cause) {
        super(message, cause);
    }
}

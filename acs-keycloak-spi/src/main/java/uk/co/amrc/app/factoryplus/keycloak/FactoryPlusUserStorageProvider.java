/* ACS Keycloak SPI
 * Per-request provider instance. Held by Keycloak for the lifetime of one
 * request (or one transaction); released via close(). State here is
 * request-scoped, not shared.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.storage.UserStorageProvider;

public class FactoryPlusUserStorageProvider implements UserStorageProvider {

    private final KeycloakSession session;
    private final ComponentModel model;

    public FactoryPlusUserStorageProvider(KeycloakSession session, ComponentModel model) {
        this.session = session;
        this.model = model;
    }

    @Override
    public void close() {
        // No resources to release yet. Future phases may hold an HTTP
        // client; release it here.
    }
}

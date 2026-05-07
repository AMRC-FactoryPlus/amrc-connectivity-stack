/* ACS Keycloak SPI
 * Factory class. Keycloak constructs exactly one of these per server
 * lifetime and calls create(...) for every request that needs to talk to
 * the Factory+ federation.
 *
 * The factory owns the FactoryPlusUserStore and hands it to each provider
 * instance - sharing the store (and any caches it holds) across requests
 * is much cheaper than constructing a fresh one per call. Phase 1 ships
 * with the NullFactoryPlusUserStore singleton; Phase 2 will instead build
 * a real HTTP-backed store here, configured from the ComponentModel.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.storage.UserStorageProviderFactory;

public class FactoryPlusUserStorageProviderFactory
        implements UserStorageProviderFactory<FactoryPlusUserStorageProvider> {

    public static final String PROVIDER_ID = "factoryplus";

    @Override
    public FactoryPlusUserStorageProvider create(KeycloakSession session, ComponentModel model) {
        return new FactoryPlusUserStorageProvider(session, model,
            NullFactoryPlusUserStore.INSTANCE);
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }
}

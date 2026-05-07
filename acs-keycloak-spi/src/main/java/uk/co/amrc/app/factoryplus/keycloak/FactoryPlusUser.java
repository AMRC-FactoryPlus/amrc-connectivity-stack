/* ACS Keycloak SPI
 * Immutable DTO returned by FactoryPlusUserStore lookups. The Adapter
 * wraps one of these as Keycloak's UserModel; the rest of the SPI never
 * touches it directly.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.app.factoryplus.keycloak;

/**
 * @param uuid     Factory+ principal UUID. Stable across renames; used as
 *                 the federated storage external id.
 * @param username Login name. May change over time in F+; never rely on
 *                 it as an identity key.
 * @param email    Email address from F+, or null if the principal has none
 *                 (service accounts often don't).
 */
public record FactoryPlusUser(String uuid, String username, String email) {
}

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
 * @param provisional True when this user has no Factory+ principal on
 *                 the local cluster yet. Provisional users come from
 *                 the cross-realm path: a trusted foreign realm vouches
 *                 for them (or will, once the KDC confirms the
 *                 password), but nothing has been written to F+ Auth.
 *                 The provider calls
 *                 {@link FactoryPlusUserStore#admit(String, String)}
 *                 to persist the identity, and only after the password
 *                 has validated.
 */
public record FactoryPlusUser(String uuid, String username, String email,
                              boolean provisional) {

    /** Ordinary (non-provisional) user; the common case. */
    public FactoryPlusUser(String uuid, String username, String email) {
        this(uuid, username, email, false);
    }
}

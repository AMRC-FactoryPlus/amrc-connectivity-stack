/* Factory+ HiveMQ auth plugin.
 * Authorizer Provider.
 * Copyright 2025 AMRC.
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import com.hivemq.extension.sdk.api.annotations.NotNull;
import com.hivemq.extension.sdk.api.annotations.Nullable;
import com.hivemq.extension.sdk.api.auth.Authorizer;
import com.hivemq.extension.sdk.api.auth.parameter.AuthorizerProviderInput;
import com.hivemq.extension.sdk.api.services.auth.provider.AuthorizerProvider;
import uk.co.amrc.factoryplus.FPServiceClient;

public class FPKrbAuthorizerProvider implements AuthorizerProvider {
    public final FPServiceClient fplus;
    public FPKrbAuthorizerProvider(FPServiceClient serviceClient) {
        fplus = serviceClient;
    }

    public @Nullable Authorizer getAuthorizer(@NotNull AuthorizerProviderInput authorizerProviderInput) {
        return new FPKrbAuthorizer(this);
    }
}

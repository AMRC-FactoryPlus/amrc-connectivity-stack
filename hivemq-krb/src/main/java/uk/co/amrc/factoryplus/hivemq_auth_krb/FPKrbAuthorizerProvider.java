package uk.co.amrc.factoryplus.hivemq_auth_krb;

import com.hivemq.extension.sdk.api.annotations.NotNull;
import com.hivemq.extension.sdk.api.annotations.Nullable;
import com.hivemq.extension.sdk.api.auth.Authorizer;
import com.hivemq.extension.sdk.api.auth.parameter.AuthorizerProviderInput;
import com.hivemq.extension.sdk.api.services.auth.provider.AuthorizerProvider;
import uk.co.amrc.factoryplus.FPServiceClient;

public class FPKrbAuthorizerProvider implements AuthorizerProvider {
    private final FPServiceClient fpServiceClient;
    public FPKrbAuthorizerProvider(FPServiceClient serviceClient) {
        fpServiceClient = serviceClient;
    }

    public @Nullable Authorizer getAuthorizer(@NotNull AuthorizerProviderInput authorizerProviderInput) {
        return new FPKrbAuthorizer(fpServiceClient);
    }
}

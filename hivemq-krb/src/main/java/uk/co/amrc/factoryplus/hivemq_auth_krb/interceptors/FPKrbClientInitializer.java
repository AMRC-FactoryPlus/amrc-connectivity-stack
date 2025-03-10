package uk.co.amrc.factoryplus.hivemq_auth_krb.interceptors;

import com.hivemq.extension.sdk.api.annotations.NotNull;
import com.hivemq.extension.sdk.api.client.ClientContext;
import com.hivemq.extension.sdk.api.client.parameter.InitializerInput;
import com.hivemq.extension.sdk.api.services.intializer.ClientInitializer;
import uk.co.amrc.factoryplus.FPServiceClient;
import uk.co.amrc.factoryplus.hivemq_auth_krb.FPKrbContext;

public class FPKrbClientInitializer implements ClientInitializer {
    final public FPKrbContext context;
    final public FPServiceClient fplus;

    public FPKrbClientInitializer(FPKrbContext context) {
        this.context = context;
        this.fplus = context.fplus;
    }

    @Override
    public void initialize(@NotNull InitializerInput initializerInput, @NotNull ClientContext clientContext) {
        clientContext.addPublishInboundInterceptor(new FPKrbInboundPublishInterceptor(this));
        clientContext.addUnsubscribeInboundInterceptor(new FPKrbUnsubscribeInboundInterceptor(this));
        clientContext.addDisconnectInboundInterceptor(new FPKrbDisconnectInboundInterceptor(this));
    }
}

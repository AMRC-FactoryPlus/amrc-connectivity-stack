package uk.co.amrc.factoryplus.hivemq_auth_krb.interceptors;

import com.hivemq.extension.sdk.api.annotations.NotNull;
import com.hivemq.extension.sdk.api.async.Async;
import com.hivemq.extension.sdk.api.interceptor.disconnect.DisconnectInboundInterceptor;
import com.hivemq.extension.sdk.api.interceptor.disconnect.parameter.DisconnectInboundInput;
import com.hivemq.extension.sdk.api.interceptor.disconnect.parameter.DisconnectInboundOutput;
import com.hivemq.extension.sdk.api.services.Services;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import uk.co.amrc.factoryplus.hivemq_auth_krb.FPKrbAuthenticator;

import java.time.Duration;
import java.util.concurrent.CompletableFuture;

public class FPKrbDisconnectInboundInterceptor implements DisconnectInboundInterceptor {
    private static final @NotNull Logger log = LoggerFactory.getLogger(FPKrbAuthenticator.class);
    private final FPKrbClientInitializer initializer;

    public FPKrbDisconnectInboundInterceptor(FPKrbClientInitializer initializer) {
        this.initializer = initializer;
    }

    @Override
    public void onInboundDisconnect(@NotNull DisconnectInboundInput disconnectInboundInput, @NotNull DisconnectInboundOutput disconnectInboundOutput) {
        //make output object async with a duration of 10 seconds
        final Async<DisconnectInboundOutput> async = disconnectInboundOutput.async(Duration.ofSeconds(10));

        final CompletableFuture<?> taskFuture = Services.extensionExecutorService().submit(() -> {
            try {
                var clientId = disconnectInboundInput.getClientInformation().getClientId();
                initializer.context.removeClientUserNameMapping(clientId);
            } catch (final Exception e) {
                log.error("Disconnect inbound interception failed:", e);
            }
            async.resume();
        });
    }
}

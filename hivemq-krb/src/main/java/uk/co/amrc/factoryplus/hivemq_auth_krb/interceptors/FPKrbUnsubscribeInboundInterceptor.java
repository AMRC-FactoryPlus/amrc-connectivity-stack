package uk.co.amrc.factoryplus.hivemq_auth_krb.interceptors;

import com.hivemq.extension.sdk.api.annotations.NotNull;
import com.hivemq.extension.sdk.api.async.Async;
import com.hivemq.extension.sdk.api.interceptor.unsubscribe.UnsubscribeInboundInterceptor;
import com.hivemq.extension.sdk.api.interceptor.unsubscribe.parameter.UnsubscribeInboundInput;
import com.hivemq.extension.sdk.api.interceptor.unsubscribe.parameter.UnsubscribeInboundOutput;
import com.hivemq.extension.sdk.api.services.Services;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import uk.co.amrc.factoryplus.hivemq_auth_krb.FPKrbAuthenticator;

import java.time.Duration;
import java.util.concurrent.CompletableFuture;

public class FPKrbUnsubscribeInboundInterceptor implements UnsubscribeInboundInterceptor {
    private static final @NotNull Logger log = LoggerFactory.getLogger(FPKrbAuthenticator.class);
    private final FPKrbClientInitializer initializer;

    public FPKrbUnsubscribeInboundInterceptor(final FPKrbClientInitializer initializer) {this.initializer = initializer;}

    @Override
    public void onInboundUnsubscribe(@NotNull UnsubscribeInboundInput unsubscribeInboundInput, @NotNull UnsubscribeInboundOutput unsubscribeInboundOutput) {

        //make output object async with a duration of 10 seconds
        final Async<UnsubscribeInboundOutput> async = unsubscribeInboundOutput.async(Duration.ofSeconds(10));

        final CompletableFuture<?> taskFuture = Services.extensionExecutorService().submit(() -> {
            var clientId = unsubscribeInboundInput.getClientInformation().getClientId();
            try {
                // Remove the client from our context storage.
                log.info("Unsubscribe from {}", clientId);
                initializer.context.removeClientUserNameMapping(initializer.context.getUsername(clientId));
                initializer.context.removeClientFromTopicMapping(initializer.context.getUsername(clientId));
            } catch (final Exception e) {
                log.info("Unsubscribe inbound interception failed:", e);
            }
            async.resume();
        });
    }
}

package uk.co.amrc.factoryplus.hivemq_auth_krb.interceptors;

import com.hivemq.extension.sdk.api.annotations.NotNull;
import com.hivemq.extension.sdk.api.auth.parameter.TopicPermission;
import com.hivemq.extension.sdk.api.interceptor.publish.PublishOutboundInterceptor;
import com.hivemq.extension.sdk.api.interceptor.publish.parameter.PublishOutboundInput;
import com.hivemq.extension.sdk.api.interceptor.publish.parameter.PublishOutboundOutput;
import com.hivemq.extension.sdk.api.async.Async;
import com.hivemq.extension.sdk.api.async.TimeoutFallback;
import com.hivemq.extension.sdk.api.services.Services;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import uk.co.amrc.factoryplus.hivemq_auth_krb.FPKrbAuthenticator;

import java.time.Duration;

import static uk.co.amrc.factoryplus.hivemq_auth_krb.AuthUtils.getACLforPrincipal;
import static uk.co.amrc.factoryplus.hivemq_auth_krb.AuthUtils.isPermissionAllowed;

public class FPKrbPublishOutboundInterceptor implements PublishOutboundInterceptor {
    private FPKrbClientInitializer initializer;
    private static final @NotNull Logger log = LoggerFactory.getLogger(FPKrbAuthenticator.class);

    public FPKrbPublishOutboundInterceptor(FPKrbClientInitializer initializer) {
        this.initializer = initializer;
    }

    @Override
    public void onOutboundPublish(@NotNull PublishOutboundInput input, @NotNull PublishOutboundOutput output) {
        final Async<PublishOutboundOutput> async = output.async(Duration.ofSeconds(10), TimeoutFallback.FAILURE);
        Services.extensionExecutorService().submit(() -> {
            final String clientId = input.getClientInformation().getClientId();
            final String username = initializer.context.getUsername(clientId);
            final String topic = input.getPublishPacket().getTopic();
            isPermissionAllowed(getACLforPrincipal(username, initializer.fplus), topic, TopicPermission.MqttActivity.SUBSCRIBE)
                    .subscribe(result -> {
                                if (!result) {
                                    log.info("Subscription outbound intercepted! permission denied for user {} topic {}", username, topic);
                                    output.preventPublishDelivery();
                                    // Clean up.
                                    initializer.context.removeClientUserNameMapping(clientId);
                                    Services.clientService().disconnectClient(clientId);
                                    System.out.println("Client " + username + " was kicked due to policy violation.");
                                }
                                async.resume();
                            },
                            error ->  {
                                log.error("Error occurred: {}", error.getMessage());
                                async.resume();
                            });
        });
    }
}

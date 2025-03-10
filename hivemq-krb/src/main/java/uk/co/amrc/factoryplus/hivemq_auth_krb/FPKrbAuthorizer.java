/* Factory+ HiveMQ auth plugin.
 * Authorizer.
 * Copyright 2025 AMRC.
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import com.hivemq.extension.sdk.api.annotations.NotNull;
import com.hivemq.extension.sdk.api.async.Async;
import com.hivemq.extension.sdk.api.auth.PublishAuthorizer;
import com.hivemq.extension.sdk.api.auth.SubscriptionAuthorizer;
import com.hivemq.extension.sdk.api.auth.parameter.*;
import com.hivemq.extension.sdk.api.services.ManagedExtensionExecutorService;
import com.hivemq.extension.sdk.api.services.Services;
import io.reactivex.rxjava3.core.Single;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import uk.co.amrc.factoryplus.FPServiceClient;

import java.time.Duration;
import java.util.List;
import java.util.stream.Collectors;

import static uk.co.amrc.factoryplus.hivemq_auth_krb.AuthUtils.*;

public class FPKrbAuthorizer implements SubscriptionAuthorizer, PublishAuthorizer {
    private final FPKrbAuthorizerProvider provider;
    private static final @NotNull Logger log = LoggerFactory.getLogger(FPKrbAuthenticator.class);

    public FPKrbAuthorizer(FPKrbAuthorizerProvider authorizerProvider) {
        provider = authorizerProvider;
    }

    @Override
    public void authorizePublish(
            @NotNull PublishAuthorizerInput input,
            @NotNull PublishAuthorizerOutput output
    ) {
        var clientId = input.getClientInformation().getClientId();
        var clientUsername = provider.context.getUsername(clientId);
        var topic = input.getPublishPacket().getTopic();
        //get the managed extension executor service
        final ManagedExtensionExecutorService extensionExecutorService = Services.extensionExecutorService();

        //make the output async with a timeout of 2 seconds
        final Async<PublishAuthorizerOutput> async = output.async(Duration.ofSeconds(2));

        //submit a task to the extension executor
        extensionExecutorService.submit(() -> {
            isPermissionAllowed(getACLforPrincipal(clientUsername, provider.fplus), topic, TopicPermission.MqttActivity.PUBLISH)
                    .subscribe(result -> {
                                if(result){
                                    output.authorizeSuccessfully();
                                    log.info("Successfully authorized publish client {} for topic {}", clientUsername, topic);
                                }else{
                                    log.info("Publish permission denied for user {} topic {}",clientUsername, topic);
                                    output.failAuthorization();
                                }
                                async.resume();
                            },
                            error ->  {
                                log.error("Error occurred: {}", error.getMessage());
                                output.failAuthorization();
                                async.resume();
                            });
        });
    }

    @Override
    public void authorizeSubscribe(
            @NotNull SubscriptionAuthorizerInput input,
            @NotNull SubscriptionAuthorizerOutput output
    ) {
        var clientId = input.getClientInformation().getClientId();
        var clientUsername = provider.context.getUsername(clientId);
        var topic = input.getSubscription().getTopicFilter();
        //get the managed extension executor service
        final ManagedExtensionExecutorService extensionExecutorService = Services.extensionExecutorService();
        //make the output async with a timeout of 2 seconds
        final Async<SubscriptionAuthorizerOutput> async = output.async(Duration.ofSeconds(2));
        //submit a task to the extension executor
        extensionExecutorService.submit(() -> {
            isPermissionAllowed(getACLforPrincipal(clientUsername, provider.fplus), topic, TopicPermission.MqttActivity.SUBSCRIBE)
                    .subscribe(result -> {
                                if (result) {
                                    log.info("Successfully authorized subscription client {} for topic {}.", clientUsername, topic);
                                    provider.context.storeTopicMapping(clientUsername, topic);
                                    output.authorizeSuccessfully();
                                } else {
                                    log.info("Subscription permission denied for user {} topic {}", clientUsername, topic);
                                    output.failAuthorization();
                                }
                                async.resume();
                            },
                            error ->  {
                                log.error("Error occurred: {}", error.getMessage());
                                output.failAuthorization();
                                async.resume();
                            });
        });
    }
}


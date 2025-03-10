package uk.co.amrc.factoryplus.hivemq_auth_krb.interceptors;

import com.hivemq.extension.sdk.api.annotations.NotNull;
import com.hivemq.extension.sdk.api.annotations.Nullable;
import com.hivemq.extension.sdk.api.async.Async;
import com.hivemq.extension.sdk.api.async.TimeoutFallback;
import com.hivemq.extension.sdk.api.client.parameter.ClientInformation;
import com.hivemq.extension.sdk.api.interceptor.publish.PublishInboundInterceptor;
import com.hivemq.extension.sdk.api.interceptor.publish.parameter.PublishInboundInput;
import com.hivemq.extension.sdk.api.interceptor.publish.parameter.PublishInboundOutput;
import com.hivemq.extension.sdk.api.packets.publish.PublishPacket;
import com.hivemq.extension.sdk.api.services.Services;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import uk.co.amrc.factoryplus.hivemq_auth_krb.FPKrbAuthenticator;

import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.function.BiConsumer;

public class FPKrbInboundPublishInterceptor implements PublishInboundInterceptor {
    FPKrbClientInitializer initializer;
    private static final @NotNull Logger log = LoggerFactory.getLogger(FPKrbAuthenticator.class);

    public FPKrbInboundPublishInterceptor(FPKrbClientInitializer fpkrbClientInitializer) {initializer = fpkrbClientInitializer;}

    @Override
    public void onInboundPublish(
            @NotNull PublishInboundInput publishInboundInput,
            @NotNull PublishInboundOutput publishInboundOutput
    ) {
        // make the output object async with a timeout duration of 10 seconds and the timeout fallback failure
        final Async<PublishInboundOutput> asyncOutput =
                publishInboundOutput.async(Duration.ofSeconds(10), TimeoutFallback.FAILURE);

        //submit external task to extension executor service
        final CompletableFuture<?> taskFuture = Services.extensionExecutorService().submit(() -> {
            final PublishPacket publish = publishInboundInput.getPublishPacket();
            final String topic = publish.getTopic();
            final ClientInformation clientInfo = publishInboundInput.getClientInformation();

            var subs = initializer.context.getTopicMapping(topic);
            log.info("Subscribed stored for topic: {} {}", topic, subs);

        });

        // add a callback for completion of the task
        taskFuture.whenComplete(new BiConsumer<Object, Throwable>() {
            @Override
            public void accept(final @Nullable Object object, final @Nullable Throwable throwable) {
                if (throwable != null) {
                    throwable.printStackTrace(); // please use more sophisticated logging
                }

                // resume output to tell HiveMQ that asynchronous precessing is done
                asyncOutput.resume();
            }
        });
    }
}

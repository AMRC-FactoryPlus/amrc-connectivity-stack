/* Factory+ HiveMQ authentication plugin.
 * Plugin main entry point.
 * Copyright 2022 AMRC.
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import com.hivemq.extension.sdk.api.ExtensionMain;
import com.hivemq.extension.sdk.api.annotations.NotNull;
import com.hivemq.extension.sdk.api.parameter.*;
import com.hivemq.extension.sdk.api.services.Services;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import uk.co.amrc.factoryplus.FPServiceClient;
import uk.co.amrc.factoryplus.FPUuid;

import java.util.concurrent.TimeUnit;

public class FPKrbMain implements ExtensionMain {

    private static final @NotNull Logger log = LoggerFactory.getLogger(FPKrbMain.class);
    @Override
    public void extensionStart(final @NotNull ExtensionStartInput extensionStartInput, final @NotNull ExtensionStartOutput extensionStartOutput) {
        final ExtensionInformation extensionInformation = extensionStartInput.getExtensionInformation();
        log.info("Started " + extensionInformation.getName() + ":" + extensionInformation.getVersion());

        var fplus = startServiceClient();

        final FPKrbAuthProvider authn = new FPKrbAuthProvider(fplus);
        final FPKrbAuthorizerProvider authorizer = new FPKrbAuthorizerProvider(fplus);

        Services.securityRegistry().setEnhancedAuthenticatorProvider(authn);
        Services.securityRegistry().setAuthorizerProvider(authorizer);
    }

    @Override
    public void extensionStop(final @NotNull ExtensionStopInput extensionStopInput, final @NotNull ExtensionStopOutput extensionStopOutput) {

        final ExtensionInformation extensionInformation = extensionStopInput.getExtensionInformation();
        log.info("Stopped " + extensionInformation.getName() + ":" + extensionInformation.getVersion());

    }

    public FPServiceClient startServiceClient ()
    {
        var fplus = new FPServiceClient();
        fplus.http().start();

        var url = fplus.getUriConf("mqtt_url");

        fplus.directory()
                .registerServiceURL(FPUuid.Service.MQTT, url)
                .retryWhen(errs -> errs
                        .doOnNext(e -> {
                            log.error("Service registration failed: {}", e.toString());
                            log.info("Retrying registration in 5 seconds.");
                        })
                        .delay(5, TimeUnit.SECONDS))
                .subscribe(() -> log.info("Registered service successfully"),
                        e -> log.error("Failed to register service: {}",
                                e.toString()));
        return fplus;
    }

}

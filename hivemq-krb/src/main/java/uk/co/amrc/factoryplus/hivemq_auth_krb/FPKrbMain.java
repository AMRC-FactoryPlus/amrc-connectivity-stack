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
import uk.co.amrc.factoryplus.hivemq_auth_krb.interceptors.FPKrbClientInitializer;

public class FPKrbMain implements ExtensionMain {

    private static final @NotNull Logger log = LoggerFactory.getLogger(FPKrbMain.class);

    @Override
    public void extensionStart(final @NotNull ExtensionStartInput extensionStartInput, final @NotNull ExtensionStartOutput extensionStartOutput) {
        final ExtensionInformation extensionInformation = extensionStartInput.getExtensionInformation();
        log.info("Started " + extensionInformation.getName() + ":" + extensionInformation.getVersion());
        var context = new FPKrbContext();
        context.start();

        final FPKrbAuthenticatorProvider authn = new FPKrbAuthenticatorProvider(context);
        final FPKrbAuthorizerProvider authorizer = new FPKrbAuthorizerProvider(context);
        final FPKrbClientInitializer clientInitializer = new FPKrbClientInitializer(context);

        Services.securityRegistry().setEnhancedAuthenticatorProvider(authn);
        Services.securityRegistry().setAuthorizerProvider(authorizer);
        Services.initializerRegistry().setClientInitializer(clientInitializer);
    }

    @Override
    public void extensionStop(final @NotNull ExtensionStopInput extensionStopInput, final @NotNull ExtensionStopOutput extensionStopOutput) {

        final ExtensionInformation extensionInformation = extensionStopInput.getExtensionInformation();

        log.info("Stopped " + extensionInformation.getName() + ":" + extensionInformation.getVersion());

    }
}

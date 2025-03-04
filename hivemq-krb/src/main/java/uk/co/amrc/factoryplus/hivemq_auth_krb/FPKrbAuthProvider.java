/* Factory+ HiveMQ auth plugin.
 * Authentication provider.
 * Copyright 2022 AMRC.
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import java.security.PrivilegedAction;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.ServiceConfigurationError;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import java.util.stream.Collectors;

import java.security.PrivilegedExceptionAction;
import java.security.PrivilegedActionException;
import javax.security.auth.Subject;
import javax.security.auth.callback.*;
import javax.security.auth.login.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.ietf.jgss.*;
import org.json.*;
import org.apache.hc.core5.net.URIBuilder;

import io.reactivex.rxjava3.core.*;

import uk.co.amrc.factoryplus.*;

import com.hivemq.extension.sdk.api.annotations.NotNull;
import com.hivemq.extension.sdk.api.annotations.Nullable;
import com.hivemq.extension.sdk.api.auth.EnhancedAuthenticator;
import com.hivemq.extension.sdk.api.auth.parameter.AuthenticatorProviderInput;
import com.hivemq.extension.sdk.api.services.auth.provider.EnhancedAuthenticatorProvider;
import com.hivemq.extension.sdk.api.auth.parameter.*;
import com.hivemq.extension.sdk.api.services.Services;
import com.hivemq.extension.sdk.api.services.builder.Builders;

public class FPKrbAuthProvider implements EnhancedAuthenticatorProvider
{
    private static final Logger log = LoggerFactory.getLogger(FPKrbAuth.class);

    public FPServiceClient fplus;

    public FPKrbAuthProvider (FPServiceClient serviceClient)
    {
        fplus = serviceClient;
    }

    @Override
    public EnhancedAuthenticator getEnhancedAuthenticator (final AuthenticatorProviderInput input)
    {
        return new FPKrbAuth(this);
    }

    public Attempt<GSSContext> createServerContext ()
    {
        return fplus.gssServer().createContext();
    }

    public Attempt<GSSContext> createProxyContext (String user, char[] passwd)
    {
        String srv = fplus.getConf("server_principal");
        return fplus.gss()
            .clientWithPassword(user, passwd)
            .createContext(srv);
    }
}

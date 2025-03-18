/* Factory+ HiveMQ auth plugin.
 * Authentication provider.
 * Copyright 2022 AMRC.
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.ietf.jgss.*;

import uk.co.amrc.factoryplus.*;

import com.hivemq.extension.sdk.api.auth.EnhancedAuthenticator;
import com.hivemq.extension.sdk.api.auth.parameter.AuthenticatorProviderInput;
import com.hivemq.extension.sdk.api.services.auth.provider.EnhancedAuthenticatorProvider;

public class FPKrbAuthenticatorProvider implements EnhancedAuthenticatorProvider
{
    private static final Logger log = LoggerFactory.getLogger(FPKrbAuthenticator.class);

    public FPServiceClient fplus;
    public FPKrbContext context;

    public FPKrbAuthenticatorProvider(FPKrbContext context)
    {
        this.fplus = context.fplus;
        this.context = context;
    }

    @Override
    public EnhancedAuthenticator getEnhancedAuthenticator (final AuthenticatorProviderInput input)
    {
        return new FPKrbAuthenticator(this);
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

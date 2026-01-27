/* Factory+ Java client library.
 * GSS client with ccache.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus.gss;

import java.util.HashMap;
import java.util.List;
import java.util.Optional;
import java.util.ServiceConfigurationError;
import java.util.concurrent.Callable;
import java.util.stream.Stream;
import java.util.stream.Collectors;

import javax.security.auth.Subject;
import javax.security.auth.callback.*;
import javax.security.auth.login.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.ietf.jgss.*;
import org.json.*;

import uk.co.amrc.factoryplus.client.Attempt;

public class FPGssClientCcache extends FPGssClient {
    public FPGssClientCcache (FPGssProvider provider)
    {
        super(provider);
    }

    protected LoginContext buildLoginContext (Subject subj)
        throws LoginException
    {
        Configuration config = new KrbConfiguration();
        CallbackHandler cb = new NullCallbackHandler();
        return new LoginContext("client-ccache", subj, cb, config);
    }
}

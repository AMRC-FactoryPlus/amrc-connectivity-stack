/* Factory+ HiveMQ auth plugin.
 * Authentication provider.
 * Copyright 2022 AMRC.
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import java.security.PrivilegedAction;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
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

import io.reactivex.rxjava3.core.*;
import io.vavr.control.Option;

import uk.co.amrc.factoryplus.client.*;
import uk.co.amrc.factoryplus.gss.FPGssResult;

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

    private static final UUID PERMGRP_UUID = UUID.fromString(
        "a637134a-d06b-41e7-ad86-4bf62fde914a");
    private static final UUID TEMPLATE_UUID = UUID.fromString(
        "1266ddf1-156c-4266-9808-d6949418b185");
    private static final UUID ADDR_UUID = UUID.fromString(
        "8e32801b-f35a-4cbf-a5c3-2af64d3debd7");

    private static final java.util.regex.Pattern UUID_SHAPE =
        java.util.regex.Pattern.compile(
            "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");

    private FPServiceClient fplus;
    private FPJwtVerifier jwt;

    public FPKrbAuthProvider ()
    {
        fplus = new FPServiceClient();
        jwt = new FPJwtVerifier(System.getenv("OIDC_DISCOVERY_URL"));
    }

    public FPKrbAuthProvider start ()
    {
        fplus.http().start();
        
        return this;
    }

    @Override
    public EnhancedAuthenticator getEnhancedAuthenticator (final AuthenticatorProviderInput input)
    {
        return new FPKrbAuth(this);
    }

    public Single<FPGssResult> verifyGSSAPI (ByteBuffer buf)
    {
        return fplus.gss().verifyGSSAPI(buf);
    }

    public Single<FPGssResult> verifyPassword (String user, CharBuffer passwd)
    {
        /* This call accesses the network in general; a plain
         * verifyGSSAPI does not. So push this off to the fplus thread
         * pool. */
        return fplus.gss()
            .verifyPassword(user, passwd)
            .subscribeOn(fplus.getScheduler());
    }

    public boolean jwtEnabled ()
    {
        return jwt.enabled();
    }

    public Single<FPGssResult> verifyJwt (String token)
    {
        /* Verification may fetch the OIDC discovery document and JWKS
         * over the network; keep it off the HiveMQ threads. */
        return Single
            .fromCallable(() -> new FPGssResult(
                jwt.verify(token), Option.none()))
            .subscribeOn(fplus.getScheduler());
    }

    public Single<List<TopicPermission>> getACLforPrincipal (String principal)
    {
        class TemplateUse {
            public Map<String, Object> template;
            public UUID target;

            public TemplateUse (JSONObject tmpl, String targ)
            {
                this.template = tmpl.toMap();
                this.target = UUID.fromString(targ);
            }
        }

        /* Principals from JWT auth are F+ principal UUIDs; kerberos
         * auth yields UPNs (which always contain '@', so the shapes
         * never collide). The Auth service routes each form through
         * the matching lookup. */
        final boolean by_uuid = UUID_SHAPE.matcher(principal).matches();

        return fplus.auth().getACL(principal, PERMGRP_UUID, by_uuid)
            .flatMapObservable(Observable::fromStream)
            .flatMapSingle(ace -> {
                String perm = (String)ace.get("permission");
                String targid = (String)ace.get("target");

                return fplus.configdb()
                    .getConfig(TEMPLATE_UUID, UUID.fromString(perm))
                    .map(tmpl -> new TemplateUse(tmpl, targid));
            })
            .flatMapStream(ace -> {
                Single<JSONObject> target = fplus.configdb()
                    .getConfig(ADDR_UUID, ace.target);
                return ace.template.entrySet().stream()
                    .map(e -> MqttAce.expandEntry(e, target));
            })
            .flatMap(Observable::fromMaybe)
            .map(m_ace -> m_ace.toTopicPermission())
            .collect(Collectors.toList());
    }
}

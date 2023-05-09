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

    private static final UUID PERMGRP_UUID = UUID.fromString(
        "a637134a-d06b-41e7-ad86-4bf62fde914a");
    private static final UUID TEMPLATE_UUID = UUID.fromString(
        "1266ddf1-156c-4266-9808-d6949418b185");
    private static final UUID ADDR_UUID = UUID.fromString(
        "8e32801b-f35a-4cbf-a5c3-2af64d3debd7");

    private FPServiceClient fplus;

    public FPKrbAuthProvider ()
    {
        fplus = new FPServiceClient();
    }

    public FPKrbAuthProvider start ()
    {
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
            .timeout(10, TimeUnit.MINUTES)
            .subscribe(() -> log.info("Registered service successfully"),
                e -> log.error("Failed to register service: {}", 
                    e.toString()));

        return this;
    }

    @Override
    public EnhancedAuthenticator getEnhancedAuthenticator (final AuthenticatorProviderInput input)
    {
        return new FPKrbAuth(this);
    }

    public GSSContext createServerContext ()
    {
        return fplus.gssServer()
            .createContext()
            .orElseThrow(() -> new ServiceConfigurationError(
                "Cannot create server GSS context"));
    }

    public Optional<GSSContext> createProxyContext (String user, char[] passwd)
    {
        String srv = fplus.gssServer().getPrincipal();
        return fplus.gss()
            .clientWithPassword(user, passwd)
            .flatMap(cli -> cli.login())
            .flatMap(cli -> cli.createContext(srv));
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

        return fplus.auth().getACL(principal, PERMGRP_UUID)
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

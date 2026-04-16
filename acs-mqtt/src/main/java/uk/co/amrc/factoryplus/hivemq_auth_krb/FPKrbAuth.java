/* Factory+ HiveMQ auth plugin.
 * Kerberos authentication.
 * Copyright 2022 AMRC
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import java.lang.Runnable;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.PrivilegedAction;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.reactivex.rxjava3.core.*;
import io.vavr.control.Option;

import com.hivemq.extension.sdk.api.async.*;
import com.hivemq.extension.sdk.api.client.parameter.Listener;
import com.hivemq.extension.sdk.api.annotations.NotNull;
import com.hivemq.extension.sdk.api.auth.EnhancedAuthenticator;
import com.hivemq.extension.sdk.api.auth.parameter.*;
import com.hivemq.extension.sdk.api.packets.auth.*;
import com.hivemq.extension.sdk.api.packets.connect.*;
import com.hivemq.extension.sdk.api.packets.general.*;
import com.hivemq.extension.sdk.api.services.Services;

import uk.co.amrc.factoryplus.client.FPServiceException;
import uk.co.amrc.factoryplus.gss.FPGssResult;

public class FPKrbAuth implements EnhancedAuthenticator {

    private static final @NotNull Logger log = LoggerFactory.getLogger(FPKrbAuth.class);

    private FPKrbAuthProvider provider;

    static record AuthResult (Option<ByteBuffer> gssToken, List<TopicPermission> acl)
    {
        public void applyACL (EnhancedAuthOutput output)
        {
            ModifiableDefaultPermissions perms = output.getDefaultPermissions();
            perms.addAll(acl);
            perms.setDefaultBehaviour(DefaultAuthorizationBehaviour.DENY);
        }

        public List<String> showACL ()
        {
            return acl.stream()
                .map(ace -> String.format("%s(%s)", 
                    ace.getActivity(), ace.getTopicFilter()))
                .collect(Collectors.toList());
        }
    }

    public FPKrbAuth (FPKrbAuthProvider prov)
    {
        provider = prov;
    }

    @Override
    public void onConnect (EnhancedAuthConnectInput input, EnhancedAuthOutput output)
    {
        final ConnectPacket conn = input.getConnectPacket();

        String mech = conn.getAuthenticationMethod().orElse(null);

        log.info("CONNECT mech {}", mech);

        if (mech == null) {
            auth_none(conn, output);
            return;
        }
        if (mech.equals("GSSAPI")) {
            auth_gssapi(conn, output);
            return;
        }

        log.info("Unknown auth mech {}", mech);
        output.failAuthentication(DisconnectedReasonCode.BAD_AUTHENTICATION_METHOD);
    }

    @Override
    public void onAuth (EnhancedAuthInput input, EnhancedAuthOutput output)
    {
        log.error("Unexpected multi-step auth attempt");
        output.failAuthentication(DisconnectedReasonCode.BAD_USER_NAME_OR_PASSWORD);
        return;
    }

    private void auth_gssapi (ConnectPacket conn, EnhancedAuthOutput output)
    {
        ByteBuffer in_bb = conn.getAuthenticationData().orElse(null);
        if (in_bb == null) {
            log.error("No GSS step data provided");
            output.failAuthentication(DisconnectedReasonCode.BAD_USER_NAME_OR_PASSWORD);
            return;
        }

        var verify = provider.verifyGSSAPI(in_bb);
        handleVerification(output, verify);
    }

    private void auth_none (ConnectPacket conn, EnhancedAuthOutput output)
    {
        String user = conn.getUserName().orElse(null);
        ByteBuffer passwd = conn.getPassword().orElse(null);

        if (user == null || passwd == null) {
            log.error("Null username/password, failing auth");
            output.failAuthentication(DisconnectedReasonCode.BAD_USER_NAME_OR_PASSWORD);
            return;
        }

        /* XXX should passwords be UTF-8? */
        var passwd_c = StandardCharsets.UTF_8.decode(passwd);

        var verify = provider.verifyPassword(user, passwd_c);
        handleVerification(output, verify);
    }

    private void handleVerification (EnhancedAuthOutput output,
        Single<FPGssResult> verify)
    {
        var asyncOutput = output.async(
            Duration.ofSeconds(10), TimeoutFallback.FAILURE,
            DisconnectedReasonCode.SERVER_BUSY);

        verify.flatMap(this::findACL)
            .doAfterTerminate(() -> asyncOutput.resume())
            .subscribe(
                rv -> {
                    switch (asyncOutput.getStatus()) {
                        case CANCELED:
                            log.warn("Timeout performing authentication");
                            return;
                        case DONE:
                            log.error("Trying to return duplicate auth result");
                            return;
                    }
                    rv.applyACL(output);
                    rv.gssToken()
                        /* These two are not the same :) */
                        .peek(output::authenticateSuccessfully)
                        .onEmpty(output::authenticateSuccessfully);
                },
                e -> {
                    log.error("Authentication failed", e);
                    var code = e instanceof FPServiceException
                        ? DisconnectedReasonCode.SERVER_BUSY
                        : DisconnectedReasonCode.BAD_USER_NAME_OR_PASSWORD;
                    output.failAuthentication(code);
                });
    }

    private Single<AuthResult> findACL (FPGssResult gres)
    {
        return provider.getACLforPrincipal(gres.upn())
            .map(acl -> new AuthResult(gres.gssToken(), acl))
            .doOnSuccess(rv -> log.info("MQTT ACL [{}]: {}", gres.upn(), rv.showACL()));
    }
}

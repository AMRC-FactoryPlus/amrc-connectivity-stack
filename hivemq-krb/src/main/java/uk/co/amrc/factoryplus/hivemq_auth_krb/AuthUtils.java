/* Factory+ HiveMQ auth plugin.
 * Authentication utilities.
 * Copyright 2025 AMRC.
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import com.hivemq.extension.sdk.api.auth.parameter.TopicPermission;
import io.reactivex.rxjava3.core.Observable;
import io.reactivex.rxjava3.core.Single;
import org.json.JSONObject;
import uk.co.amrc.factoryplus.FPServiceClient;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

public class AuthUtils {
    private static final UUID PERMGRP_UUID = UUID.fromString(
            "a637134a-d06b-41e7-ad86-4bf62fde914a");
    private static final UUID TEMPLATE_UUID = UUID.fromString(
            "1266ddf1-156c-4266-9808-d6949418b185");
    private static final UUID ADDR_UUID = UUID.fromString(
            "8e32801b-f35a-4cbf-a5c3-2af64d3debd7");

    public static Single<List<TopicPermission>> getACLforPrincipal (String principal, FPServiceClient fplus)
    {
        class TemplateUse {
            public final Map<String, Object> template;
            public final UUID target;

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
                .map(MqttAce::toTopicPermission)
                .collect(Collectors.toList());
    }
}

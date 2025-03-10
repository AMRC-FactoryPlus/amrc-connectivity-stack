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

    /**
     * Check if an MQTT topic matches a topic from the principles acl.
     * @param existing The topic filter someone has subscribed or published to (may contain wildcards)
     * @param target The actual topic a message was subscribed or published to (no wildcards)
     * @return true if the topics match, false otherwise
     */
    public static boolean matchesPermission(String existing, String target) {
        // Split topics into parts
        String[] subParts = existing.split("/");
        String[] pubParts = target.split("/");

        // Handle special case where the subscription is just "#"
        if (existing.equals("#")) {
            return true;
        }

        // Ensure '#' is only used at the end
        for (int i = 0; i < subParts.length - 1; i++) {
            if (subParts[i].equals("#")) {
                return false; // Invalid use of '#'
            }
        }

        // Handle '#' wildcard
        if (subParts[subParts.length - 1].equals("#")) {
            int prefixLength = subParts.length - 1;

            // Check if the topic has at least as many levels as the prefix
            for (int i = 0; i < prefixLength; i++) {
                if (!subParts[i].equals("+") && !subParts[i].equals(pubParts[i])) {
                    return false;
                }
            }

            // If prefix matches, # covers the rest
            return true;
        }

        // Lengths must match for an exact match (no # wildcard)
        if (subParts.length != pubParts.length) {
            return false;
        }

        // Check each level
        for (int i = 0; i < subParts.length; i++) {
            if (!subParts[i].equals("+") && !subParts[i].equals(pubParts[i])) {
                return false;
            }
        }

        return true;
    }

    /**
     * Gets the permissions for a mqtt activity from a principles permission list.
     * @param permissions All mqtt topic permissions from a principle.
     * @param mqttActivity The type of mqtt activity to filter for.
     * @return Topic permissions for a mqtt activity.
     */
    private static Single<List<TopicPermission>> getAllowedPermissions(
            Single<List<TopicPermission>> permissions,
            TopicPermission.MqttActivity mqttActivity
    ) {
        return permissions.map(permissionList -> permissionList.stream()
                .filter(permission -> permission.getActivity() == mqttActivity)
                .filter(permission -> permission.getType() == TopicPermission.PermissionType.ALLOW)
                .collect(Collectors.toList()));
    }

    /**
     * Checks if the topic being published or subscribed to is allowed based on the principles acl.
     * @param permissions The principle's permission.
     * @param targetPermission The Permission to check.
     * @param mqttActivity The MQTT activity (publish or subscribe).
     * @return If the MQTT action for the target permission is allowed.
     */
    public static Single<Boolean> isPermissionAllowed(
            Single<List<TopicPermission>> permissions,
            String targetPermission,
            TopicPermission.MqttActivity mqttActivity
    ) {
        return getAllowedPermissions(permissions, mqttActivity)
                .map(filteredPermissions -> filteredPermissions.stream()
                        .anyMatch(permission -> matchesPermission(permission.getTopicFilter(), targetPermission))
                );
    }
}

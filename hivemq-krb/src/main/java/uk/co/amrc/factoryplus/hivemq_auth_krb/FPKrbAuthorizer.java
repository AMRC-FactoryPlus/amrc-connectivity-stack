package uk.co.amrc.factoryplus.hivemq_auth_krb;

import com.hivemq.extension.sdk.api.annotations.NotNull;
import com.hivemq.extension.sdk.api.auth.PublishAuthorizer;
import com.hivemq.extension.sdk.api.auth.SubscriptionAuthorizer;
import com.hivemq.extension.sdk.api.auth.parameter.*;
import io.reactivex.rxjava3.core.Observable;
import io.reactivex.rxjava3.core.Single;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import uk.co.amrc.factoryplus.FPServiceClient;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

public class FPKrbAuthorizer implements SubscriptionAuthorizer, PublishAuthorizer {
    private FPServiceClient fplus;
    private static final @NotNull Logger log = LoggerFactory.getLogger(FPKrbAuth.class);

    //TODO: move this to uuid class
    private static final UUID PERMGRP_UUID = UUID.fromString(
            "a637134a-d06b-41e7-ad86-4bf62fde914a");
    private static final UUID TEMPLATE_UUID = UUID.fromString(
            "1266ddf1-156c-4266-9808-d6949418b185");
    private static final UUID ADDR_UUID = UUID.fromString(
            "8e32801b-f35a-4cbf-a5c3-2af64d3debd7");

    public FPKrbAuthorizer(FPServiceClient fpServiceClient) {
        fplus = fpServiceClient;
    }

    @Override
    public void authorizePublish(
            @NotNull PublishAuthorizerInput publishAuthorizerInput,
            @NotNull PublishAuthorizerOutput publishAuthorizerOutput
    ) {
        var clientId = publishAuthorizerInput.getClientInformation().getClientId();
        var clientUsername = ClientSessionStore.getUsername(clientId);
        var topic = publishAuthorizerInput.getPublishPacket().getTopic();
        try{
            isPermissionAllowed(getACLforPrincipal(clientUsername), topic, TopicPermission.MqttActivity.PUBLISH)
                    .subscribe(result -> {
                        if(result){
                            publishAuthorizerOutput.authorizeSuccessfully();
                            log.info("Successfully authorized publish client {} for topic {}", clientUsername, topic);
                        }else{
                            log.info("Publish permission denied for user {} topic {}",clientUsername, topic);
                            publishAuthorizerOutput.failAuthorization();
                        }
                    });
        }
        catch(Exception e){
            log.info("Error {} Publish permission denied for topic {}",e.getMessage(), topic);
            publishAuthorizerOutput.failAuthorization();
        }
    }

    @Override
    public void authorizeSubscribe(
            @NotNull SubscriptionAuthorizerInput subscriptionAuthorizerInput,
            @NotNull SubscriptionAuthorizerOutput subscriptionAuthorizerOutput
    ) {
        var clientId = subscriptionAuthorizerInput.getClientInformation().getClientId();
        var clientUsername = ClientSessionStore.getUsername(clientId);
        var topic = subscriptionAuthorizerInput.getSubscription().getTopicFilter();
        try{
            isPermissionAllowed(getACLforPrincipal(clientUsername), topic, TopicPermission.MqttActivity.SUBSCRIBE)
                    .subscribe(result -> {
                        if(result){
                            log.info("Successfully authorized subscription client {} for topic {}.", clientUsername, topic);
                            subscriptionAuthorizerOutput.authorizeSuccessfully();
                        }else{
                            log.info("Subscription permission denied for user {} topic {}", clientUsername, topic);
                            subscriptionAuthorizerOutput.failAuthorization();
                        }
                    });
        }
        catch(Exception e){
            log.info("Error {} Subscription permission denied for topic {}",e.getMessage(), topic);
            subscriptionAuthorizerOutput.failAuthorization();
        }
    }

    public static Single<List<TopicPermission>> getAllowedPublishPermissions(Single<List<TopicPermission>> permissions, TopicPermission.MqttActivity mqttActivity) {
        return permissions.map(permissionList -> permissionList.stream()
                .filter(permission -> permission.getActivity() == mqttActivity) // Keep only PUBLISH permissions
                .filter(permission -> permission.getType() == TopicPermission.PermissionType.ALLOW) // Ensure ALLOWED permissions
                .collect(Collectors.toList()));
    }

    public static Single<Boolean> isPermissionAllowed(Single<List<TopicPermission>> permissions, String targetPermission, TopicPermission.MqttActivity mqttActivity) {
        return getAllowedPublishPermissions(permissions, mqttActivity)
                .map(filteredPermissions -> filteredPermissions.stream()
                        .anyMatch(permission -> matchesPermission(permission, targetPermission)) // Compare with target permission
                );
    }

    private static boolean matchesPermission(TopicPermission existing, String target) {
        return existing.getTopicFilter().equals(target); // Modify this comparison as needed
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


/* Factory+ HiveMQ auth plugin.
 * MQTT ACE class.
 * Copyright 2022 AMRC.
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import java.util.concurrent.Callable;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

import org.json.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.hivemq.extension.sdk.api.auth.parameter.*;
import com.hivemq.extension.sdk.api.services.builder.Builders;

class MqttAce {
    private static final Logger log = LoggerFactory.getLogger(MqttAce.class);

    private String topic;
    private TopicPermission.MqttActivity activity;

    public String getTopic() { return topic; }
    public TopicPermission.MqttActivity getActivity() { return activity; }

    public MqttAce (String topic, Object access, Callable<JSONObject> get_target)
    {

        this.topic = topic;
        this.activity = null;

        try {
            Matcher interp = Pattern.compile("%[gn]").matcher(topic);
            if (interp.find()) {
                JSONObject target = get_target.call();
                this.topic = interp.replaceAll(match -> {
                    String rv = null;
                    switch (match.group()) {
                        case "%n":
                            rv = target.getString("node_id");
                            break;
                        case "%g":
                            rv = target.getString("group_id");
                            break;
                    }
                    return Matcher.quoteReplacement(rv);
                });
            }
        }
        catch (Exception e) {
            //log.error("Topic interpolation failed", e.toString());
            access = "";
        }

        if (access instanceof String) {
            String rw = (String)access;
            if (rw.contains("r")) {
                if (rw.contains("w"))
                    activity = TopicPermission.MqttActivity.ALL;
                else
                    activity = TopicPermission.MqttActivity.SUBSCRIBE;
            }
            else {
                if (rw.contains("w"))
                    activity = TopicPermission.MqttActivity.PUBLISH;
            }
        }
    }

    public TopicPermission toTopicPermission ()
    {
        return Builders.topicPermission()
            .activity(getActivity())
            .topicFilter(getTopic())
            .type(TopicPermission.PermissionType.ALLOW)
            .build();
    }
}


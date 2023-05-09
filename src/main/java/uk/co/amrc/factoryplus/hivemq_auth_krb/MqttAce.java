/* Factory+ HiveMQ auth plugin.
 * MQTT ACE class.
 * Copyright 2022 AMRC.
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import java.util.Map;
import java.util.concurrent.Callable;
import java.util.regex.*;

import org.json.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.reactivex.rxjava3.core.*;

import com.hivemq.extension.sdk.api.auth.parameter.*;
import com.hivemq.extension.sdk.api.services.builder.Builders;

class MqttAce {
    private static final Logger log = LoggerFactory.getLogger(MqttAce.class);


    private String topic;
    private TopicPermission.MqttActivity activity;

    private MqttAce (String t, TopicPermission.MqttActivity a)
    {
        topic = t;
        activity = a;
    }

    public String getTopic() { return topic; }
    public TopicPermission.MqttActivity getActivity() { return activity; }

    private static TopicPermission.MqttActivity expandAccess (Object access)
    {
        if (access instanceof String) {
            String rw = (String)access;
            if (rw.contains("r")) {
                if (rw.contains("w"))
                    return TopicPermission.MqttActivity.ALL;
                return TopicPermission.MqttActivity.SUBSCRIBE;
            }
            else {
                if (rw.contains("w"))
                    return TopicPermission.MqttActivity.PUBLISH;
            }
        }
        return null;
    }

    private static final Pattern TEMPLATES = Pattern.compile("%[gn]");
    
    private static String expandTemplate (MatchResult match, JSONObject target)
    {
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
    }

    public static Maybe<MqttAce> expandEntry (Map.Entry entry,
        Single<JSONObject> get_target)
    {
        var activity = expandAccess(entry.getValue());
        if (activity == null)
            return Maybe.<MqttAce>empty();

        String topic = (String)entry.getKey();
        Matcher interp = TEMPLATES.matcher(topic);
        if (!interp.find())
            return Maybe.just(new MqttAce(topic, activity));

        return get_target.toMaybe()
            .map(target -> 
                interp.replaceAll(match -> expandTemplate(match, target)))
            .map(tp -> new MqttAce(tp, activity))
            //.doOnError(e -> log.error("Topic interpolation failed: {}",
            //    e.toString()))
            .onErrorComplete();
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


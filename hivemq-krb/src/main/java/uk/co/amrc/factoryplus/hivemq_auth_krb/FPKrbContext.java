package uk.co.amrc.factoryplus.hivemq_auth_krb;

import com.hivemq.extension.sdk.api.annotations.NotNull;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import uk.co.amrc.factoryplus.FPServiceClient;
import uk.co.amrc.factoryplus.FPUuid;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

public class FPKrbContext {
    private final ConcurrentHashMap<String, String> sessionMap = new ConcurrentHashMap<>();
    private static final @NotNull Logger log = LoggerFactory.getLogger(FPKrbMain.class);
    public  FPServiceClient fplus;

    /**
     * Creates and starts the service client.
     */
    public void start(){
        fplus = startServiceClient();
    }

    /**
     * Add a username, client id mapping to the session context.
     * @param clientId MQTT client id given by the broker.
     * @param username The users kerberos principle.
     */
    public void storeUsername(String clientId, String username) {
        if (username != null) {
            sessionMap.put(clientId, username);
        }
    }

    /**
     * Gets the kerberos principle for a client id.
     * @param clientId MQTT client given by the broker.
     * @return The kerberos principle linked to the client id.
     */
    public String getUsername(String clientId) {
        return sessionMap.get(clientId);
    }

    /**
     * Removes a username, client id mapping from the session context.
     * @param clientId client id mapping to remove.
     */
    public void removeClient(String clientId) {
        sessionMap.remove(clientId);
    }

    private FPServiceClient startServiceClient ()
    {
        var fplus = new FPServiceClient();
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
                .subscribe(() -> log.info("Registered service successfully"),
                        e -> log.error("Failed to register service: {}",
                                e.toString()));
        return fplus;
    }
}

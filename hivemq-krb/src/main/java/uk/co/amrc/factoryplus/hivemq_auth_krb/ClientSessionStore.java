package uk.co.amrc.factoryplus.hivemq_auth_krb;

import java.util.concurrent.ConcurrentHashMap;

public class ClientSessionStore {
    private static final ConcurrentHashMap<String, String> sessionMap = new ConcurrentHashMap<>();

    public static void storeUsername(String clientId, String username) {
        if (username != null) {
            sessionMap.put(clientId, username);
        }
    }

    public static String getUsername(String clientId) {
        return sessionMap.get(clientId);
    }

    public static void removeClient(String clientId) {
        sessionMap.remove(clientId);
    }
}

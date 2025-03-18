/* Factory+ HiveMQ auth plugin.
 * F+ Auth client.
 * Copyright 2023 AMRC.
 */


package uk.co.amrc.factoryplus;

import java.util.*;
import java.util.stream.Stream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.json.*;

import io.reactivex.rxjava3.core.*;

/**
 * Authentication service.
 *
 * This implementation is incomplete and does not map all endpoints.
 * Unmapped endpoints can be accessed through the generic http()
 * interface of FPServiceClient.
 */
public class FPAuth {
    private static final Logger log = LoggerFactory.getLogger(FPAuth.class);
    private static final UUID SERVICE = FPUuid.Service.Authentication;
    private final FPServiceClient fplus;
    private final RequestCache<String, JSONArray> cache;
    public FPAuth (FPServiceClient fplus)
    {
        this.fplus = fplus;
        this.cache = new RequestCache<>(5, this::getACL);
    }

    public Single<Stream<Map>> getOrFetchAcl(String principal){
        return this.cache.getOrFetch(principal)
                .map(acl -> acl.toList().stream()
                .filter(o -> o instanceof Map)
                .map(o -> (Map)o));
    }

    /**
     * Fetches an ACL.
     *
     * Fetches a list of all permissions granted to the given principal,
     * specified as a Kerberos principal name, in the given permission
     * group.
     *
     * The requesting client must have permission to read the given
     * permission group.
     *
     * @param princ The principal to fetch permissions for.
     * @return A stream of maps representing the granted permissions.
     */
    public Single<JSONArray> getACL (String princ)
    {
        //FPThreadUtil.logId("fetching acl");
        return fplus.http().request(SERVICE, "GET")
            .withURIBuilder(b -> b
                .appendPath("v2/acl/kerberos/" + princ))
            .fetch()
            .map(res -> res.ifOk()
                .flatMap(r -> r.getBodyArray())
                .orElseThrow(() -> new FPServiceException(SERVICE, 
                    res.getCode(), "Can't fetch ACL")))
            .doOnSuccess(acl -> log.info("F+ ACL [{}]: {}", princ, acl));
    }
}

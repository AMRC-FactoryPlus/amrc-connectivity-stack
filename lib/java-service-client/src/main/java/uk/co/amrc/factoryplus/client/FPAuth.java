/* Factory+ HiveMQ auth plugin.
 * F+ Auth client.
 * Copyright 2023 AMRC.
 */


package uk.co.amrc.factoryplus.client;

import java.net.*;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.json.*;

import io.reactivex.rxjava3.schedulers.Schedulers;
import io.reactivex.rxjava3.core.*;

import io.vavr.collection.*;
import io.vavr.control.Option;

import uk.co.amrc.factoryplus.http.*;
import uk.co.amrc.factoryplus.util.*;

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

    /** A single grant in the Auth service.
     * This class represents grants as used for service permission
     * checks: these do not have principal or plural fields, and do
     * not contain group UUIDs.
     */
    public record Grant (UUID permission, UUID target)
    {
        public static Grant fromJSON (JSONObject json)
        {
            return new Grant(
                UUID.fromString(json.getString("permission")),
                UUID.fromString(json.getString("target")));
        }
    }

    private FPServiceClient fplus;
    private FPNotifyV2 notify;

    private Option<String> root_principal;
    private Map<String, List<Grant>> bootstrap_acls;
    private CacheSeq<String, Response<List<Grant>>> acl_cache;

    public FPAuth (FPServiceClient fplus)
    {
        this.fplus = fplus;

        this.root_principal = fplus.getOptionConf("root_principal");
        this.bootstrap_acls = HashMap.empty();

        this.notify = new FPNotifyV2(fplus, SERVICE);
        this.acl_cache = CacheSeq.builder(this::_watchACL)
            .withReplay()
            .withTimeout(30, TimeUnit.MINUTES)
            .build();
    }

    /** Set the bootstrap ACLs.
     * This must be called before the FPServiceClient.start to avoid
     * problems with multithreaded access.
     */
    public void setBootstrapACLs (Map<String, List<Grant>> bsACLs)
    {
        this.bootstrap_acls = bsACLs;
    }

    public boolean isRoot (String upn)
    {
        return root_principal
            .filter(upn::equals)
            .isDefined();
    }

    /**
     * Fetches an ACL over HTTP.
     *
     * Fetches a list of all permissions granted to the given principal,
     * specified as a Kerberos principal name. The permission group is
     * ignored by current versions of the Auth service.
     *
     * This uses the HTTP API and makes a fresh request every time.
     * Where the HTTP backend supports a client-side cache a response
     * may come from the cache. This method does not honour bootstrap
     * ACLs or the root principal setting.
     *
     * Note the return value uses Java rather than Vavr types, for
     * compatibility. This is used by the HiveMQ plugin; once that has
     * been upgraded to use the newer APIs this method can be removed.
     *
     * @deprecated Use fetchACL instead.
     * @param princ The principal to fetch permissions for.
     * @param perms The permission group to fetch (ignored).
     * @return A stream of maps representing the granted permissions.
     */
    public Single<Stream<java.util.Map>> getACL (String princ, UUID perms)
    {
        //FPThreadUtil.logId("fetching acl");
        return fplus.http().request(SERVICE, "GET")
            .withURIBuilder(b -> b
                .appendPath("authz/acl")
                .setParameter("principal", princ)
                .setParameter("permission", perms.toString()))
            .fetch()
            .map(res -> res.ifOk()
                .flatMap(r -> r.getBodyArray())
                .orElseThrow(() -> new FPServiceException(SERVICE, 
                    res.getCode(), "Can't fetch ACL")))
            .doOnSuccess(acl -> log.info("F+ ACL [{}]: {}", princ, acl))
            .map(acl -> acl.toList().stream()
                .filter(o -> o instanceof java.util.Map)
                .map(o -> (java.util.Map)o));
    }

    private <T> Observable<Response<T>> fixedResponse (T value)
    {
        return Observable.just(Response.ok(value))
            .concatWith(Observable.never());
    }

    /** Watch a principal's ACL over notify.
     *
     * The ACLs are wrapped in Responses to allow for error handling.
     * The returned Observable is shared and cached for 30m.
     *
     * @param upn The Kerberos principal name.
     */
    public Observable<Response<List<Grant>>> watchACL (String upn)
    {
        var bs = bootstrap_acls.get(upn);
        if (bs.isDefined())
            return fixedResponse(bs.get());

        return this.acl_cache.get(
            UrlPath.join("v2", "acl", "kerberos", upn));
    }

    private Observable<Response<List<Grant>>> _watchACL (String path)
    {
        /* XXX There are casts here which can fail if the server returns
         * an invalid response. If a Response contained a generic
         * Throwable rather than always a status code we could handle
         * these better. */
        return notify.watchFull(FPNotifyRequest.watch(path))
            .map(res -> res
                .map(a -> (JSONArray)a) /* XXX Response.ofType? */
                .map(a -> List.ofAll(a)
                    .map(g -> (JSONObject)g)
                    .map(Grant::fromJSON)));
    }

    /** Watch a specific permission check.
     * This handles wildcard matches.
     * @param upn The Kerberos UPN.
     * @param perm The permission UUID.
     * @param targ The target UUID.
     */
    public Observable<Response<Boolean>> watchPermitted (String upn, UUID perm, UUID targ)
    {
        if (isRoot(upn))
            return fixedResponse(true);

        return watchACL(upn)
            .map(res -> res
                .map(gs -> gs.exists(
                    g -> g.permission.equals(perm) &&
                        (g.target.equals(targ) || g.target.equals(FPUuid.Null)))));
    }

    /** Check a specific permission.
     * The Single will emit an error if the Auth service can't be
     * contacted.
     */
    public Single<Boolean> fetchPermitted (String upn, UUID perm, UUID targ)
    {
        return watchPermitted(upn, perm, targ)
            .firstElement()
            .flatMap(r -> r.toMaybe(st ->
                new FPServiceException(SERVICE, st, "Fetching ACL")))
            .switchIfEmpty(Single.just(false))
            .timeout(10, TimeUnit.SECONDS, Single.error(
                () -> new FPServiceException(SERVICE, 502, "Timeout fetching ACL")));
    }
}

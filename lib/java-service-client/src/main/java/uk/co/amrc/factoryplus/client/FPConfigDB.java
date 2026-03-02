/* Factory+ HiveMQ auth plugin.
 * F+ ConfigDB client.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus.client;

import java.net.*;
import java.util.Optional;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.json.*;

import io.reactivex.rxjava3.schedulers.Schedulers;
import io.reactivex.rxjava3.core.*;

import io.vavr.collection.HashSet;
import io.vavr.collection.List;
import io.vavr.collection.Map;
import io.vavr.collection.Set;
import io.vavr.control.Try;

import uk.co.amrc.factoryplus.http.*;
import uk.co.amrc.factoryplus.util.*;

/**
* The Config Database.
 *
 * This implementation is incomplete and does not map all endpoints.
 * Unmapped endpoints can be accessed through the generic http()
 * interface of FPServiceClient.
 */
public class FPConfigDB {
    private static final Logger log = LoggerFactory.getLogger(FPConfigDB.class);
    private static final UUID SERVICE = FPUuid.Service.ConfigDB;

    private FPServiceClient fplus;
    private FPNotifyV2 notify;
    private CacheSeq<String, Set<UUID>> set_cache;

    public FPConfigDB (FPServiceClient fplus)
    {
        this.fplus = fplus;

        this.notify = new FPNotifyV2(fplus, SERVICE);
        this.set_cache = CacheSeq.builder(this::_watchSet)
            .withReplay()
            .build();
    }

    private FPHttpRequest request (String method)
    {
        return fplus.http().request(SERVICE, method);
    }

    /** Fetches a single config entry.
     *
     * This will presently only fetch config entries that are JSON
     * objects.
     *
     * @param appid The Application UUID.
     * @param objid The Object UUID.
     * @return A JSONObject holding the config entry.
     */
    public Single<JSONObject> getConfig (UUID appid, UUID objid)
    {
        return request("GET")
            .withURIBuilder(b -> b
                .appendPath("v1/app")
                .appendPath(appid.toString())
                .appendPath("object")
                .appendPath(objid.toString()))
            .fetch()
            .map(res -> res.ifOk()
                .flatMap(r -> r.getBodyObject())
                .orElseThrow(() -> new FPServiceException(SERVICE,
                    res.getCode(), "Can't fetch ConfigDB entry")));
    }

    /** Watch a URL returning a set of UUIDs.
     * The watch results are expected to be arrays of UUIDs. Invalid
     * responses and invalid UUIDs are ignored. A terminating slash will
     * be appended to the watched path.
     *
     * The returned Observable is cached with a 5s unsubscription
     * timeout. All Set-returning Observables use this cache.
     *
     * @param parts URL path components
     */
    public Observable<Set<UUID>> watchSet (List<Object> parts)
    {
        return this.set_cache.get(UrlPath.join(parts, true));
    }
    public Observable<Set<UUID>> _watchSet (String path)
    {
        return notify.watch(path)
            .map(ov -> ov
                .filter(v -> v instanceof JSONArray)
                .map(l -> List.ofAll((JSONArray)l)
                    .flatMap(u -> Try.success(u)
                        .mapTry(String.class::cast)
                        .mapTry(UUID::fromString)
                        .toList())
                    .transform(HashSet::ofAll))
                .orElseGet(HashSet::empty))
            .distinctUntilChanged()
            .map(Set::narrow);
    }

    /** Watch a config entry.
     * Returns a sequence which emits a value every time the config
     * entry changes. If the entry is nonexistent or inaccessible emit
     * an empty Optional. The entry is decoded with the json.org
     * decoders. The returned Observable is not cached.
     * @param app An Application UUID.
     * @param obj An Object UUID.
     */
    public Observable<Optional<Object>> watchConfig (UUID app, UUID obj)
    {
        return notify.watch(UrlPath.join("v2", "app", app, "object", obj));
    }

    /** Watch the objects with entries for a given App.
     * @param app An Application UUID.
     */
    public Observable<Set<UUID>> watchList (UUID app)
    {
        return this.watchSet(List.of("v1", "app", app, "object"));
    }

    /** Watch all entries for a given App.
     * Each Map emitted by the Observable contains an entry for every
     * config under the given Application. Whenever any entry changes
     * the sequence will emit a new complete Map. Map values have been
     * decoded with the json.org decoders.
     *
     * If the application does not exist an empty Map will be emitted.
     * If we receive errors (e.g. permission problems) no Maps will be
     * emitted until they are resolved.
     *
     * The returned Observable is not cached.
     *
     * @param app An Application UUID.
     */
    /* No implementation of filters yet, we don't have a use case. */
    public Observable<Map<UUID, Object>> searchApp (UUID app)
    {
        return this.notify.search(List.of("v1", "app", app, "object"));
    }

    /** Watch the members of a class.
     * @param klass A class UUID.
     */
    public Observable<Set<UUID>> watchMembers (UUID klass) {
        return this.watchSet(List.of("v2", "class", klass, "member"));
    }
    /** Watch the subclasses of a class.
     * @param klass A class UUID.
     */
    public Observable<Set<UUID>> watchSubclasses (UUID klass) {
        return this.watchSet(List.of("v2", "class", klass, "subclass"));
    }
    /** Watch the direct members of a class.
     * @param klass A class UUID.
     */
    public Observable<Set<UUID>> watchDirectMembers (UUID klass) {
        return this.watchSet(List.of("v2", "class", klass, "direct", "member"));
    }
    /** Watch the direct subclasses of a class.
     * @param klass A class UUID.
     */
    public Observable<Set<UUID>> watchDirectSubclasses (UUID klass) {
        return this.watchSet(List.of("v2", "class", klass, "direct", "subclass"));
    }

    /* I haven't implemented the powerset methods yet; we don't have a
     * use for them in Java, and I'm wondering if they would be better
     * served by some form of SEARCH endpoint in any case. */
}

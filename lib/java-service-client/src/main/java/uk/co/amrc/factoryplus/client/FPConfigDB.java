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
import io.vavr.collection.Set;
import io.vavr.control.Try;

import uk.co.amrc.factoryplus.http.*;

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

    public FPConfigDB (FPServiceClient fplus)
    {
        this.fplus = fplus;

        this.notify = new FPNotifyV2(fplus, SERVICE);
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

    /** Watch a config entry.
     * Returns a sequence which emits a value every time the config
     * entry changes. If the entry is nonexistent or inaccessible emit
     * an empty Optional. The entry is decoded with the json.org
     * decoders.
     * @param app An Application UUID.
     * @param obj An Object UUID.
     */
    public Observable<Optional<Object>> watch_config (UUID app, UUID obj)
    {
        return notify.watch("v2", "app", app, "object", obj);
    }

    /** Watch a URL returning a set of UUIDs.
     * The watch results are expected to be arrays of UUIDs. Invalid
     * responses and invalid UUIDs are ignored.
     * @param parts URL path components
     */
    public Observable<Set<UUID>> watch_set (Object... parts)
    {
        return notify.watch(parts)
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
}

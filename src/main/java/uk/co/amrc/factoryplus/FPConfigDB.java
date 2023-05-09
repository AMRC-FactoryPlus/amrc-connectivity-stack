/* Factory+ HiveMQ auth plugin.
 * F+ ConfigDB client.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus;

import java.net.*;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.json.*;

import io.reactivex.rxjava3.schedulers.Schedulers;
import io.reactivex.rxjava3.core.*;

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

    public FPConfigDB (FPServiceClient fplus)
    {
        this.fplus = fplus;
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
                .orElseThrow(() ->
                    new Exception("ConfigDB entry not an object")));
    }
}

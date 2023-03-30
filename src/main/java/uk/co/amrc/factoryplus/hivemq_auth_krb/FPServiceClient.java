/* Factory+ HiveMQ auth plugin.
 * F+ service client.
 * Copyright 2022 AMRC.
 */

package uk.co.amrc.factoryplus.hivemq_auth_krb;

import java.net.*;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.ServiceConfigurationError;
import java.util.stream.Stream;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.hc.client5.http.HttpResponseException;
import org.apache.hc.client5.http.fluent.Request;
import org.apache.hc.client5.http.fluent.Response;
import org.apache.hc.client5.http.impl.cache.CacheConfig;
import org.apache.hc.client5.http.impl.cache.CachingHttpClients;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.core5.http.ContentType;
import org.apache.hc.core5.net.URIBuilder;

import org.json.*;

public class FPServiceClient {
    private static final Logger log = LoggerFactory.getLogger(FPServiceClient.class);

    private URI authn_service;
    private URI configdb_service;
    private String service_auth;

    private CloseableHttpClient http_client;

    public FPServiceClient ()
    {
        authn_service = get_uri_env("AUTHN_URL");
        configdb_service = get_uri_env("CONFIGDB_URL");

        String srv_user = safe_getenv("SERVICE_USERNAME");
        String srv_pass = safe_getenv("SERVICE_PASSWORD");
        service_auth = "Basic " 
            + Base64.getEncoder().encodeToString(
                (srv_user + ":" + srv_pass).getBytes());

        CacheConfig cache_config = CacheConfig.custom()
            .setSharedCache(false)
            .build();
        http_client = CachingHttpClients.custom()
            .setCacheConfig(cache_config)
            .build();
    }

    private String safe_getenv (String env)
    {
        String val = System.getenv(env);
        if (val == null || val == "")
            throw new ServiceConfigurationError(
                String.format("Environment variable %s must be set!", env));
        return val;
    }

    private URI get_uri_env (String env)
    {
        String uri = safe_getenv(env);
        try {
            return new URI(uri);
        }
        catch (URISyntaxException e) {
            throw new ServiceConfigurationError(
                String.format("Bad URI for %s: %s", env, uri));
        }
    }

    public Object fetch (String method, URI uri, JSONObject json)
    {
        try {
            //log.info("Fetch: req: {} {}", method, uri.toString());
            Request req = Request.create(method, uri)
                .setHeader("Authorization", service_auth);

            if (json != null) {
                req.bodyString(json.toString(), ContentType.APPLICATION_JSON);
            }

            Response rsp = req.execute(http_client);
            String body = rsp.returnContent().asString();
            //log.info("Fetch: rsp: {}", body);
            
            if (body == null) return null;
            return new JSONTokener(body).nextValue();
        }
        catch (HttpResponseException e) {
            int st = e.getStatusCode();
            if (st != 404)
                log.error("Fetch HTTP error: {}", st);
            return null;
        }
        catch (Exception e) {
            log.info("Fetch error: {}", e);
            return null;
        }
    }

    public Object fetch (String method, URIBuilder builder, JSONObject json)
    {
        try {
            URI uri = builder.build();
            return fetch(method, uri, json);
        }
        catch (URISyntaxException e) {
            log.error("Fetch for bad URI: {}", e.toString());
            return null;
        }
    }

    public Stream<String> configdb_list_objects (String appid)
    {
        URIBuilder path = new URIBuilder(configdb_service)
            .appendPath("/v1/app")
            .appendPath(appid)
            .appendPath("object");
        JSONArray ary = (JSONArray)fetch("GET", path, null);

        if (ary == null) return null;
        return ary.toList().stream().map(o -> (String)o);
    }

    public JSONObject configdb_fetch_object (String appid, String objid)
    {
        URIBuilder path = new URIBuilder(configdb_service)
            .appendPath("/v1/app")
            .appendPath(appid)
            .appendPath("object")
            .appendPath(objid);
        return (JSONObject)fetch("GET", path, null);
    }

    public Stream<Map> authn_acl (String princ, String perms)
    {
        URIBuilder acl_url = new URIBuilder(authn_service)
            .appendPath("/authz/acl")
            .setParameter("principal", princ)
            .setParameter("permission", perms);
        //log.info("ACL url {}", acl_url);
        JSONArray acl = (JSONArray)fetch("GET", acl_url, null);
        log.info("F+ ACL [{}]: {}", princ, acl);

        if (acl == null) return null;
        return acl.toList().stream().map(o -> (Map)o);
    }
}


/* Factory+ HiveMQ auth plugin.
 * F+ service client.
 * Copyright 2022 AMRC.
 */

package uk.co.amrc.factoryplus;

import java.net.*;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.ServiceConfigurationError;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.Executor;
import java.util.stream.Stream;
import java.util.stream.Collectors;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.hc.core5.net.URIBuilder;
import org.json.*;

import io.reactivex.rxjava3.schedulers.Schedulers;
import io.reactivex.rxjava3.core.*;

import uk.co.amrc.factoryplus.gss.*;
import uk.co.amrc.factoryplus.http.*;

/**
 * Represents a client of the Factory+ services.
 */
public class FPServiceClient {
    private static final Logger log = LoggerFactory.getLogger(FPServiceClient.class);

    private Map<String, String> config;
    private Executor _executor;
    private Scheduler _scheduler;

    /* I'm not sure this is the best way to do this... possibly a Map
     * would be better? */
    private FPGssProvider _gss;
    private FPGssServer _gss_server;
    private FPGssClient _gss_client;
    private FPHttpClient _http;
    private FPDiscovery _discovery;
    private FPDirectory _directory;
    private FPAuth _auth;
    private FPConfigDB _configdb;

    /** Use configuration from the environment.
     *
     * This constructor will pull configuration entirely from the
     * environment.
     */
    public FPServiceClient () { 
        this(Map.<String,String>of());
    }

    /** Override some or all of the configuration.
     *
     * This constructor will use the supplied configuration entries.
     * Where an entry is not present, the environment will be used.
     *
     * @param config Configuration overrides.
     */
    public FPServiceClient (Map config)
    {
        this.config = config;
    }

    /** Gets a configuration parameter.
     *
     * If an override was supplied it will be returned. Otherwise the
     * key will be uppercased and looked up in the process environment.
     *
     * @param key The config parameter.
     * @return The config value.
     * @throws ServiceConfigurationError If the config parameter is not
     * supplied anywhere.
     */
    public String getConf (String key)
    {
        return getOptionalConf(key)
            .orElseThrow(() -> new ServiceConfigurationError(
                String.format("Config %s not found!", key)));
    }

    /** Get an optional config parameter.
     *
     * Fetches a config parameter (as {@link #getConf(String)}) but does
     * not throw if the parameter is unavailable.
     *
     * @param key The config parameter.
     * @return An Optional of the value.
     */
    public Optional<String> getOptionalConf (String key)
    {
        if (config.containsKey(key))
            return Optional.of(config.get(key));

        String env = key.toUpperCase(Locale.ROOT);
        String val = System.getenv(env);
        if (val == null || val == "")
            return Optional.<String>empty();

        return Optional.of(val);
    }

    /** Get a config parameter which is a URL.
     *
     * Fetches a (required) config parameter and parses it to a URI.
     *
     * @param env The config parameter.
     * @return The URI value.
     * @throws ServiceConfigurationError
     *  If the parameter is absent or if an invalid URI is supplied.
     */
    public URI getUriConf (String env)
    {
        String uri = getConf(env);
        try {
            return new URI(uri);
        }
        catch (URISyntaxException e) {
            throw new ServiceConfigurationError(
                String.format("Bad URI for %s: %s", env, uri));
        }
    }

    /** Sets the Executor to use for async work.
     *
     * This will be used to create a Rx Scheduler.
     *
     * @param exec The Executor to use.
     * @throws IllegalStateException
     *  If {@link #getScheduler()} has already been called.
     */
    synchronized public void setExecutor (Executor exec)
    {
        if (_scheduler != null)
            throw new IllegalStateException(
                "Can't set executor: scheduler has already been created");

        _executor = exec;
    }

    /** Fetches the Rx Scheduler to use.
     *
     * This will construct from a provided Executor or generate a
     * default thread pool.
     */
    synchronized public Scheduler getScheduler ()
    {
        if (_scheduler == null) {
            var exec = _executor != null ? _executor
                : Executors.newScheduledThreadPool(4);
            _scheduler = Schedulers.from(exec, true, true);
        }
        return _scheduler;
    }

    synchronized public FPGssProvider gss ()
    {
        if (_gss == null)
            _gss = new FPGssProvider();
        return _gss;
    }

    /** Fetches our server GSS credentials.
     *
     * This uses the <code>service_principal</code> and
     * <code>server_keytab</code> config params to create a FPGssServer
     * instance.
     *
     * @return Our server-side GSS credentials.
     */
    synchronized public FPGssServer gssServer ()
    {
        if (_gss_server == null) {
            String princ = getConf("server_principal");
            String keytab = getConf("server_keytab");

            _gss_server = gss().server(princ, keytab)
                .flatMap(s -> s.login())
                .orElseThrow(() -> new ServiceConfigurationError(
                    "Cannot get server GSS creds"));
        }

        return _gss_server;
    }

    /** Fetches our client GSS credentials.
     *
     * If the <code>service_username</code> and
     * <code>service_password</code> config entries are supplied, this
     * will perform a new Kerberos login with those credentials.
     * Otherwise this will assume a populated ccache is available and
     * use that.
     *
     * Note that in both cases this requires a valid krb5 configuration
     * and access to the KDC.
     *
     * @return Our client-side GSS credentials.
     */
    synchronized public FPGssClient gssClient ()
    {
        if (_gss_client == null) {
            var user = getOptionalConf("service_username");
            var passwd = getOptionalConf("service_password");

            var cli = user.isEmpty() || passwd.isEmpty()
                ? gss().clientWithCcache()
                : gss().clientWithPassword(user.get(),
                    passwd.get().toCharArray());
            _gss_client = cli
                .flatMap(c -> c.login())
                .orElseThrow(() -> new ServiceConfigurationError(
                    "Cannot get client GSS creds"));
        }
        return _gss_client;
    }

    synchronized public FPHttpClient http ()
    {
        if (_http == null)
            _http = new FPHttpClient(this);
        return _http;
    }

    synchronized public FPDiscovery discovery ()
    {
        if (_discovery == null)
            _discovery = new FPDiscovery(this);
        return _discovery;
    }

    synchronized public FPDirectory directory ()
    {
        if (_directory == null)
            _directory = new FPDirectory(this);
        return _directory;
    }

    synchronized public FPAuth auth ()
    {
        if (_auth == null)
            _auth = new FPAuth(this);
        return _auth;
    }

    synchronized public FPConfigDB configdb ()
    {
        if (_configdb == null)
            _configdb = new FPConfigDB(this);
        return _configdb;
    }

}


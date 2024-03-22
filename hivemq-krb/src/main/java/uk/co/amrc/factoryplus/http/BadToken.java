/* Factory+ Java client library.
 * Bad token exception class.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus.http;

import java.net.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.*;

class BadToken extends Exception
{
    private static final Logger log = LoggerFactory.getLogger(BadToken.class);

    private URI base;
    private String token;

    public BadToken (URI base, String tok)
    { 
        this.base = base;
        this.token = tok; 
    }

    public URI getBase () { return base; }
    public String getToken () { return token; }

    public boolean invalidate (RequestCache<URI, String> tokens)
    {
        log.info("Retrying; bad token {} for {}",
            token.substring(0, 5), base);
        tokens.remove(base, token);
        return true;
    }
}

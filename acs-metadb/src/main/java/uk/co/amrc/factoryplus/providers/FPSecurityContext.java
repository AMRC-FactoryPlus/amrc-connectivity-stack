/*
 * Factory+ service api
 * F+ SecurityContext implementation
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.providers;

import java.nio.ByteBuffer;
import java.security.Principal;

import jakarta.ws.rs.core.*;
import jakarta.ws.rs.ext.*;

import uk.co.amrc.factoryplus.gss.FPGssResult;

public record FPSecurityContext (String scheme, FPGssResult gssResult)
    implements SecurityContext 
{
    /* XXX intern this? */
    private record Princ (String name) implements Principal
    {
        public String getName () { return name; }
    }

    public String getAuthenticationScheme () { return scheme; }
    public Principal getUserPrincipal () { return new Princ(upn()); }

    /* Don't know about these, and don't care. */
    public boolean isSecure () { return true; }
    public boolean isUserInRole (String role) { return false; }

    public String upn () { return gssResult.upn(); }
}


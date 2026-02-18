/*
 * Factory+ Java service client
 * Interface for request which can 
 */

package uk.co.amrc.factoryplus.http;

import java.net.URI;
import java.util.UUID;

interface ResolvableRequest<Res>
{
    UUID getService ();
    PerformableRequest<Res> resolveWith (URI base, String token);
}

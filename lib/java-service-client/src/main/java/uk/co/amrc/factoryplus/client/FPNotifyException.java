/* 
 * Factory+ Java service client
 * Notify/v2 update exception
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.client;

import java.util.Map;
import java.util.UUID;

public class FPNotifyException extends FPServiceException
{
    private FPNotifyRequest request;

    public FPNotifyException (UUID service, int status, FPNotifyRequest request)
    {
        super(service, status, "Notify error");
        this.request = request;
    }
}

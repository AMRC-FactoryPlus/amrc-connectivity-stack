/* Factory+ Java client library.
 * Service exception class.
 * Copyright 2024 AMRC.
 */

package uk.co.amrc.factoryplus.client;

import java.util.UUID;

public class FPServiceException extends Exception
{
    private UUID service;
    private int status;

    public FPServiceException (UUID service, int status, String message)
    { 
        super(message);
        this.service = service;
        this.status = status;
    }

    public FPServiceException (UUID service, String message)
    {
        this(service, 0, message);
    }

    public UUID getService () { return service; }
    public int getStatus () { return status; }

    public String getMessage () {
        String msg = super.getMessage();
        if (status == 0)
            return String.format("[%s] %s", this.service, msg);
        else
            return String.format("[%s] (%d) %s", this.service, this.status, msg);
    }

    public boolean hasService (UUID service) { return this.service == service; }
    public boolean hasStatus (int status) { return this.status == status; }

    public static boolean check (Throwable err, UUID service, int status)
    {
        if (!(err instanceof FPServiceException))
            return false;
        var sverr = (FPServiceException)err;
        return sverr.hasService(service) && sverr.hasStatus(status);
    }
}

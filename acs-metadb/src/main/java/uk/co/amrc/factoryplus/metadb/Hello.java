package uk.co.amrc.factoryplus.metadb;

import jakarta.ws.rs.*;

@Path("hello")
public class Hello {
    @GET
    @Produces("text/plain")
    public String hello ()
    {
        return "Hello world: this " + this.toString();
    }
}

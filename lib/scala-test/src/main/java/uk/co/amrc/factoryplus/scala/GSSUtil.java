package uk.co.amrc.factoryplus.scala;

import org.ietf.jgss.GSSManager;

public final class GSSUtil
{
    public static GSSManager getGSSManager ()
    {
        return GSSManager.getInstance();
    }

    public static String getGSSString ()
    {
        return getGSSManager().toString();
    }

    public static Object getGSSObject ()
    {
        return getGSSManager();
    }
}

/*
 * Factory+ service api
 * An infinite Iterable true, false, false, …
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import java.util.Iterator;

public class IsFirst implements Iterable<Boolean>
{
    private static class It implements Iterator<Boolean>
    {
        private boolean first = true;

        public boolean hasNext () { return true; }

        public Boolean next ()
        {
            if (first) {
                first = false;
                return true;
            }
            return false;
        }
    }

    private static final IsFirst isFirst = new IsFirst();

    public static IsFirst isFirst () { return isFirst; }

    private IsFirst () { }

    public Iterator<Boolean> iterator ()
    {
        return new It();
    }
}

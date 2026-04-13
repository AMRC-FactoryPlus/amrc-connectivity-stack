/*
 * Factory+ Java service client
 * URL path manipulation
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.util;

import java.lang.StringBuilder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import io.vavr.collection.List;

public final class UrlPath
{
    private static final String HEX = "0123456789abcdef";
    private static final byte[] SAFE =
        "!'()*-.0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~"
            .getBytes(StandardCharsets.US_ASCII);

    /* This is ridiculous. Neither the JRE nor Jetty have a correct
     * equivalent to encodeURIComponent. */
    public static String encodeURIComponent (String str)
    {
        var bytes = str.getBytes(StandardCharsets.UTF_8);
        var builder = new StringBuilder(bytes.length);

        for (var c : bytes) {
            if (Arrays.binarySearch(SAFE, c) >= 0)
                builder.append((char)c);
            else
                builder.append('%')
                    .append(HEX.charAt(c >> 4 & 0xf))
                    .append(HEX.charAt(c & 0xf));
        }

        return builder.toString();
    }

    public static String decodeURI (String str)
    {
        var b = new StringBuilder(str.length());

        var ix = 0;
        while (true) {
            var pct = str.indexOf('%', ix);
            
            if (pct == -1) break;
            b.append(str, ix, pct);

            ix = pct + 3;
            if (ix > str.length())
                throw new IllegalArgumentException("Bad URI encoding: " + str);

            b.appendCodePoint(Integer.parseUnsignedInt(str, pct+1, ix, 16));
        }
        b.append(str, ix, str.length());

        return b.toString();
    }

    public static String join (List<Object> args, boolean dir)
    {
        return args
            .map(Object::toString)
            .map(UrlPath::encodeURIComponent)
            .mkString("", "/", dir ? "/" : "");
    }

    public static String join (List<Object> args)
    {
        return join(args, false);
    }

    public static String join (Object... args)
    {
        return join(List.of(args));
    }

    public static String joinDir (Object... args)
    {
        return join(List.of(args), true);
    }
}

/*
 * Factory+ Java service client
 * URL path manipulation
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.util;

import java.lang.StringBuilder;
import java.nio.charset.StandardCharsets;

import io.vavr.collection.List;

public final class UrlPath
{
    private static final String HEX = "0123456789abcdef";

    /* This is ridiculous. Neither the JRE nor Jetty have a correct
     * equivalent to encodeURIComponent. */
    public static String encodeURIComponent (String str)
    {
        var bytes = str.getBytes(StandardCharsets.UTF_8);
        var builder = new StringBuilder(bytes.length);

        for (var c : bytes) {
            var safe =
                c >= 'a' ? c <= 'z' || c == '~' :
                c >= 'A' ? c <= 'Z' || c == '_' :
                c >= '0' ? c <= '9' :
                c == '-' || c == '.';

            if (safe)
                builder.append((char)c);
            else
                builder.append('%')
                    .append(HEX.charAt(c >> 4 & 0xf))
                    .append(HEX.charAt(c & 0xf));
        }

        return builder.toString();
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

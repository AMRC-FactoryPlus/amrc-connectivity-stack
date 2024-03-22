package uk.co.amrc.factoryplus;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class FPThreadUtil {
    static final Logger log = LoggerFactory.getLogger(FPThreadUtil.class);

    public static void logId (String msg)
    {
        log.info("{} on {} ({})",
            msg,
            Thread.currentThread().getId(),
            Thread.currentThread().getName());
    }
}

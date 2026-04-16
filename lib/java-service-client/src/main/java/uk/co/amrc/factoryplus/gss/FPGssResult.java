/* Factory+ Java client library.
 * GSS auth result record.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.gss;

import java.nio.ByteBuffer;
import io.vavr.control.Option;

public record FPGssResult (String upn, Option<ByteBuffer> gssToken)
{
}

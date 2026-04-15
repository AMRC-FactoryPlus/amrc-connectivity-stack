/* Factory+ Java client library.
 * GSS auth result record.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.gss;

import java.nio.ByteBuffer;

public record FPGssResult (String upn, ByteBuffer gssToken)
{
}

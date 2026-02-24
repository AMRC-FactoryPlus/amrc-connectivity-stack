/* 
 * Factory+ JVM service client
 * Scala ConfigDB extensions
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.client

import java.util.UUID
import scala.jdk.CollectionConverters.*

import io.reactivex.rxjava3.core.*
import io.vavr.{collection as vavr}

extension [T](it: Iterable[T])
    def toVList: vavr.List[T] = vavr.List.ofAll(it.asJava)

extension [T](s: vavr.Set[T])
    def toScala: Set[T] = s.toJavaSet.asScala.toSet

extension (cdb: FPConfigDB)
    def watchSetScala (parts: Iterable[Any]) = cdb
        .watchSet(parts.toVList)
        .map(s => s.toScala)

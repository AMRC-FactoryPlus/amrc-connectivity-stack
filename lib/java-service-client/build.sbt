organization := "io.github.amrc-factoryplus"
version := "0.1-SNAPSHOT"
crossPaths := false

scalaVersion := "3.3.7"

val slf4j         = "2.0.17"
val apacheHttp    = "5.6"
val jetty         = "12.1.5"

scalacOptions ++= Seq(
)

libraryDependencies ++= Seq(
    "org.slf4j" %               "slf4j-api" %           slf4j,
    "org.json" %                "json" %                "20251224",
    "org.apache.commons" %      "commons-lang3" %       "3.20.0",
    "org.apache.httpcomponents.client5" %
                                "httpclient5" %         apacheHttp,
    "org.apache.httpcomponents.client5" %
                                "httpclient5-cache" %   apacheHttp,
    "io.reactivex.rxjava3" %    "rxjava" %              "3.1.12",
    "io.vavr" %                 "vavr" %                "1.0.0",
    "org.eclipse.jetty" %       "jetty-client" %        jetty,
    "org.eclipse.jetty.websocket" %
                                "jetty-websocket-jetty-client" %
                                                        jetty,

    "org.slf4j" %               "slf4j-simple" %        slf4j       % "test",
)

publishTo := Some(MavenCache("in-tree", baseDirectory.value / "../mvn"))

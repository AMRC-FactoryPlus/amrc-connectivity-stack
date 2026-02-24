scalaVersion := "3.3.7"

resolvers += "ACS in-tree" at (baseDirectory.value / "../mvn").toURI.toString

libraryDependencies ++= Seq(
  "io.github.amrc-factoryplus" % "java-service-client" % "0.1-SNAPSHOT",

  "org.slf4j" % "slf4j-simple" % "2.0.17" % "test",
)

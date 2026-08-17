FROM docker.getcollate.io/openmetadata/server:1.13.3

# The upstream image bundles log4j-core/log4j-api 2.25.5 under
# /opt/openmetadata/libs. Swap in a patched 2.x release - log4j2's public API
# is stable across patch versions, so this is a safe drop-in without needing
# to touch the OpenMetadata server itself. ADD's remote-URL support is used
# instead of curl/wget since the Alpine base image doesn't ship either.
ARG LOG4J_VERSION=2.26.1

USER root
RUN rm -f /opt/openmetadata/libs/log4j-core-*.jar /opt/openmetadata/libs/log4j-api-*.jar
ADD --chown=openmetadata:openmetadata https://repo1.maven.org/maven2/org/apache/logging/log4j/log4j-core/${LOG4J_VERSION}/log4j-core-${LOG4J_VERSION}.jar /opt/openmetadata/libs/log4j-core-${LOG4J_VERSION}.jar
ADD --chown=openmetadata:openmetadata https://repo1.maven.org/maven2/org/apache/logging/log4j/log4j-api/${LOG4J_VERSION}/log4j-api-${LOG4J_VERSION}.jar /opt/openmetadata/libs/log4j-api-${LOG4J_VERSION}.jar
USER openmetadata

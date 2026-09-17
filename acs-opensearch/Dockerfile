FROM opensearchproject/opensearch:3.8.0

# The upstream image bundles log4j-core/log4j-api 2.25.4. Swap in a patched
# 2.x release - log4j2's public API is stable across patch versions, so
# this is a safe drop-in without needing to touch OpenSearch itself. ADD's
# remote-URL support is used instead of curl/wget since the AL2023 base
# image doesn't ship either.
ARG LOG4J_VERSION=2.26.1

USER root
RUN rm -f /usr/share/opensearch/lib/log4j-core-*.jar /usr/share/opensearch/lib/log4j-api-*.jar
ADD --chown=opensearch:opensearch https://repo1.maven.org/maven2/org/apache/logging/log4j/log4j-core/${LOG4J_VERSION}/log4j-core-${LOG4J_VERSION}.jar /usr/share/opensearch/lib/log4j-core-${LOG4J_VERSION}.jar
ADD --chown=opensearch:opensearch https://repo1.maven.org/maven2/org/apache/logging/log4j/log4j-api/${LOG4J_VERSION}/log4j-api-${LOG4J_VERSION}.jar /usr/share/opensearch/lib/log4j-api-${LOG4J_VERSION}.jar

# The Performance Analyzer agent runs as a separate JVM and loads its own
# classpath from performance-analyzer-rca/lib (see
# OPENSEARCH_ADDITIONAL_CLASSPATH_DIRECTORIES in performance-analyzer-agent-cli),
# independent of the main /usr/share/opensearch/lib classpath patched above.
# It bundles its own log4j-core/log4j-api, so it needs patching separately -
# otherwise it stays on the vulnerable version no matter how many times the
# image above is rebuilt.
RUN rm -f /usr/share/opensearch/performance-analyzer-rca/lib/log4j-core-*.jar /usr/share/opensearch/performance-analyzer-rca/lib/log4j-api-*.jar
ADD --chown=opensearch:opensearch https://repo1.maven.org/maven2/org/apache/logging/log4j/log4j-core/${LOG4J_VERSION}/log4j-core-${LOG4J_VERSION}.jar /usr/share/opensearch/performance-analyzer-rca/lib/log4j-core-${LOG4J_VERSION}.jar
ADD --chown=opensearch:opensearch https://repo1.maven.org/maven2/org/apache/logging/log4j/log4j-api/${LOG4J_VERSION}/log4j-api-${LOG4J_VERSION}.jar /usr/share/opensearch/performance-analyzer-rca/lib/log4j-api-${LOG4J_VERSION}.jar
USER opensearch 
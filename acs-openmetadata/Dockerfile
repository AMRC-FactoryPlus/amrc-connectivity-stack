FROM openmetadata/ingestion:1.13.3

# Pre-install the package during image build time
RUN pip install --no-cache-dir "apache-airflow-providers-fab==2.4.4"

# pyspark bundles its own log4j-core/log4j-api (2.20.0), which is in the
# affected range for CVE-2025-68161/CVE-2026-34477/CVE-2026-34480. Swap in a
# patched 2.x release - log4j2's public API is stable across patch
# versions, so this is a safe drop-in without needing to touch pyspark
# itself or know whether the Spark profiling engine is actually used.
ARG LOG4J_VERSION=2.25.4
RUN PYSPARK_JARS="$(python -c 'import os, pyspark; print(os.path.join(os.path.dirname(pyspark.__file__), "jars"))')" \
    && rm -f "${PYSPARK_JARS}"/log4j-core-*.jar "${PYSPARK_JARS}"/log4j-api-*.jar \
    && python -c "import urllib.request as r; r.urlretrieve('https://repo1.maven.org/maven2/org/apache/logging/log4j/log4j-core/${LOG4J_VERSION}/log4j-core-${LOG4J_VERSION}.jar', '${PYSPARK_JARS}/log4j-core-${LOG4J_VERSION}.jar')" \
    && python -c "import urllib.request as r; r.urlretrieve('https://repo1.maven.org/maven2/org/apache/logging/log4j/log4j-api/${LOG4J_VERSION}/log4j-api-${LOG4J_VERSION}.jar', '${PYSPARK_JARS}/log4j-api-${LOG4J_VERSION}.jar')"
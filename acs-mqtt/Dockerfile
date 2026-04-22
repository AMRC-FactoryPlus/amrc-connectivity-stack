FROM hivemq/hivemq-ce:2025.5

ARG mvn_output=hivemq-auth-krb-0.0.0.zip

USER root
RUN touch extensions/hivemq-allow-all-extension/DISABLED \
    && apt-get update \
    && apt-get install unzip

COPY target/${mvn_output} /tmp/hivemq-auth-krb.zip
RUN (cd extensions && unzip -o /tmp/hivemq-auth-krb.zip) \
    && rm -f /tmp/hivemq-auth-krb.zip

USER 10000

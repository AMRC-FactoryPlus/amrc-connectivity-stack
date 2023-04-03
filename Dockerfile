FROM hivemq/hivemq-ce:2023.2

ARG krb_zipfile=hivemq-auth-krb-0.1.5-distribution.zip
RUN rm /opt/hivemq/extensions/hivemq-kafka-extension/DISABLED
COPY ${krb_zipfile} /tmp

RUN touch extensions/hivemq-allow-all-extension/DISABLED \
    && apt-get update \
    && apt-get install unzip \
    && (cd extensions && unzip -o /tmp/${krb_zipfile}) \
    && rm -f /tmp/${krb_zipfile}

FROM eclipse-temurin:25-jre

ARG mvn_output=acs-metadb-0.0.0.jar

RUN install -d -o root -g root /home/app
RUN install -d -o 1000 -g 1000 /home/app/tdb
COPY target/${mvn_output} /home/app/acs-metadb.jar

USER 1000
WORKDIR /home/app
CMD ["java", "-jar", "acs-metadb.jar"]

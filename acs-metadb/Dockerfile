FROM eclipse-temurin:25-jre

ARG jar=acs-metadb-0.1-SNAPSHOT.jar

RUN install -d -o root -g root /home/app
RUN install -d -o 1000 -g 1000 /home/app/tdb
COPY target/${jar} /home/app/acs-metadb.jar

USER 1000
WORKDIR /home/app
CMD ["java", "-jar", "acs-metadb.jar"]

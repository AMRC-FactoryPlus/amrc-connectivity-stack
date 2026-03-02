# Build Java packages with Maven
#
# config.mk settings:
#
# JAVA_HOME	As usual for Java. Defaults to /usr.
# M2_HOME	As documented for Maven. Defaults to /usr.
# MVN		Maven binary. Defaults to ${M2_HOME}/bin/mvn.

# These defaults only apply to Linux where package managers install to
# /usr normally. On other systems they will need configuring.
JAVA_HOME?=	/usr
M2_HOME?=	/usr
MVN?=		'${M2_HOME}'/bin/mvn

mvnenv=	JAVA_HOME='${JAVA_HOME}' M2_HOME='${M2_HOME}' M2='${M2_HOME}/bin'
mvn=	env ${mvnenv} ${MVN}

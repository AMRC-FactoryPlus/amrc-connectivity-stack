top=..
include ${top}/mk/acs.init.mk

repo?=acs-mqtt
k8s.deployment?=mqtt

include ${mk}/acs.docker.mk
include ${mk}/acs.mvn.mk

# Compute the maven output filename at recipe time via shell
# substitution. The previous `zip!= mvn ...` form relied on `!=` which
# the macOS-default GNU make 3.81 and BSD make don't honour - it
# silently parsed `zip!` as a variable and left ${zip} undefined,
# yielding `--build-arg mvn_output=` (empty) and a Dockerfile that
# tried to unzip a non-existent file. The $$(...) wrapper makes this
# portable: make expands ${mvn} normally, $$ becomes $ in the recipe,
# and the shell evaluates the substitution.
build_args+=	--build-arg mvn_output=$$(${mvn} -q help:evaluate \
		-Dexpression=acs.output -DforceStdout)

.PHONY: mqtt.build mqtt.clean

build: mqtt.build

mqtt.build: git.prepare
	${mvn} package

clean: mqtt.clean

mqtt.clean:
	rm -rf target

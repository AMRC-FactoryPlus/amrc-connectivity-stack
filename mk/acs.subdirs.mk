recurse=	env MAKE="${MAKE}" \
		SUBDIRS_PARALLEL="${SUBDIRS_PARALLEL}" \
		SUBDIRS_SERIAL_FIRST="${SUBDIRS_SERIAL_FIRST}" \
		${tools}/recurse

all: git.prepare
	+${recurse} all ${subdirs}

setup: git.prepare
	+${recurse} setup ${subdirs}

lint: git.prepare
	+${recurse} lint ${subdirs}

clean:
	+${recurse} clean ${subdirs}

include ${mk}/acs.git.mk

# Set up initial variables for all Makefiles

ifndef .acs.init.mk
.acs.init.mk=

mk=${top}/mk
tools=${mk}/tools

-include ${top}/config.mk
-include config.mk

.PHONY: all

# This is defined here so it becomes the default target.
# Make sure it stays first.
all:

# Define do-nothing standard targets.

.PHONY: build lint setup clean

build:

lint:

setup:

clean:

endif

# Set up initial variables for all Makefiles

ifndef .acs.init.mk
.acs.init.mk=

mk=${top}/mk

-include ${top}/config.mk
-include config.mk

.PHONY: all

# This is defined here so it becomes the default target.
# Make sure it stays first.
all:

endif

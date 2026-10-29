# Include this Makefile for Elixir services

ifndef .acs.ex.mk
.acs.ex.mk=1

base_version?=	${git.tag}

build_args+=	--build-arg base_version="${base_version}"

.PHONY: ex.deps ex.lint

setup: ex.deps

ex.deps:
	mix deps.get

# These need Elixir installed; the image build doesn't.
lint: ex.lint

ex.lint:
	mix format --check-formatted
	mix compile --warnings-as-errors
	mix credo

include ${mk}/acs.docker.mk

endif

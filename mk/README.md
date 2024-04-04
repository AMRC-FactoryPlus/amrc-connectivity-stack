# ACS Makefiles

This is a set of Makefile fragments used for building ACS images for
local development. Currently they are not used for building ACS
releases, that is handled by the Github Actions. Consquently there is no
overall 'build everything' target as that wouldn't be useful at this
point.

The Makefiles are 'almost POSIX'; please keep them that way. In
particular please make sure they remain compatible with [GNU
ake](https://www.gnu.org/software/make/manual/make.html) and [PDP
Make](https://frippery.org/make/).

## Useful targets

These can be invoked with `make TARGET` from within the relevant
subdir, or `make -C SUBDIR TARGET` from elsewhere. Adding `-n` will show
the commands to be run without running them.

* `all`: This is the default target if you just run `make`. This will
  build and push an image for subdirs that build an image.

* `build`: Just build an image.

* `push`: Just push an image (which must be already built).

* `deploy`: For those subdirs which support this, this will attempt to
  restart a k8s deployment and show the logs. This requires `KUBECONFIG`
  to be set properly in the environment.

* `amend`: Amend the last git commit.

## Configuration

The Makefiles all read `config.mk` at the top-level and in their own
subdir. This can set variables to change the behaviour of the targets.
Some useful variables are:

* `registry`: The Docker registry to build images under.

* `version`: By default the version number comes from the most recent
  tag. This will override it.

* `suffix`: This will be appended to the version on the image tag.

* `acs_npm`: An alternative NPM registry to use for `@amrc-factoryplus`.

* `git.allow_dirty`: Set (to anything) to disable the check for a clean
  working directory.

* `git.pull`: Set (to anything) to run `git pull` before building.

## Writing a Makefile

Every Makefile using this set of Make fragments should follow this
structure (this is `acs-auth`):

    top=..
    include ${top}/mk/acs.init.mk

    repo?=acs-auth
    k8s.deployment?=auth

    include ${mk}/acs.js.mk

The initial two lines should always come first; `top` needs to be set to
a relative path to the top of the source tree. Including `acs.init.mk`
sets `mk` to a path to the Makefiles and reads the `config.mk` files.

Then we set variables configuring this build. In this case: `repo` sets
the repository part of a Docker image name, and `k8s.deployment`
configures `make deploy`.

Then we include Makefiles to perform a build. `acs.js.mk` is for Docker
images which include a Javascript service; it pulls in `acs.docker.mk`
which builds a Docker image. See the Makefiles themselves for more
details.

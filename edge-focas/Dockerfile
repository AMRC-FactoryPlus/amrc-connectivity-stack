# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
ARG acs_npm=NO
ARG revision=unknown

USER root
RUN <<'SHELL'
    install -d -o node -g node /home/node/app
SHELL
WORKDIR /home/node/app
USER node
COPY package*.json ./
RUN <<'SHELL'
    touch /home/node/.npmrc
    if [ "${acs_npm}" != NO ]
    then
        npm config set @amrc-factoryplus:registry "${acs_npm}"
    fi

    npm install --save=false
SHELL
COPY --chown=node . .
RUN <<'SHELL'
    echo "export const GIT_VERSION=\"$revision\";" > ./lib/git-version.js
SHELL

FROM node:22-alpine AS run
# Install runtime dependencies for FOCAS library
USER root
RUN <<'SHELL'
    apk add --no-cache \
        gcompat \
        libstdc++ \
        libgcc
SHELL

# Create directory for FOCAS library
RUN mkdir -p /usr/local/lib && chmod 755 /usr/local/lib

# Copy across from the build container.
WORKDIR /home/node/app
COPY --from=build --chown=root:root /home/node/app ./

# Copy FOCAS library if provided during build
# Usage: docker build --build-arg FOCAS_LIB=./libfwlib32.so .
ARG FOCAS_LIB
COPY ${FOCAS_LIB:-/dev/null} /usr/local/lib/libfwlib32.so* 2>/dev/null || true

# Set library path and verify FOCAS library
RUN <<'SHELL'
    echo "/usr/local/lib" > /etc/ld.so.conf.d/focas.conf
    ldconfig

    # Check if FOCAS library was provided and is valid
    if [ -f "/usr/local/lib/libfwlib32.so" ]; then
        echo "FOCAS library found, checking dependencies..."
        ldd /usr/local/lib/libfwlib32.so || echo "Warning: Could not verify library dependencies"
        chmod 755 /usr/local/lib/libfwlib32.so
        echo "FOCAS library setup complete"
    else
        echo "WARNING: FOCAS library not provided during build"
        echo "The driver will fail to connect without the library"
        echo "To include the library, build with:"
        echo "  docker build --build-arg FOCAS_LIB=./path/to/libfwlib32.so ."
    fi
SHELL

USER node
CMD node bin/driver.js

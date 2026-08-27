# Stage 1: Build the application
#
# Debian 12 (bookworm), glibc 2.36. The 1.2.0 image was Debian 11
# (bullseye, glibc 2.31) and rollup's prebuilt Linux binary now needs
# 2.34, so it failed to dlopen at build time.
FROM oven/bun:1.2.23-debian AS builder
ARG tag="(unknown version)"

# Set working directory
WORKDIR /app/acs-admin

# Copy package.json and install dependencies. The lockfile is copied
# without a glob so a missing one fails here rather than silently
# resolving the whole tree fresh from the registry on every build.
COPY package.json bun.lock ./
RUN --mount=type=bind,from=lib,dst=/app/lib bun install --production --frozen-lockfile

# Copy the rest of the application code
COPY . .
RUN echo "export const ACS_VERSION = '${tag}';" >src/lib/version.js

# Build the application
RUN --mount=type=bind,from=lib,dst=/app/lib bun run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Copy the standalone binary to the image
COPY import-meta-env-alpine import-meta-env-alpine

# Make the binary executable
RUN chmod +x import-meta-env-alpine

# Copy built files from the builder stage
COPY --from=builder /app/acs-admin/dist /usr/share/nginx/html

# Copy custom Nginx configuration file
COPY .docker/nginx.conf /etc/nginx/conf.d/default.conf

# Expose the port Nginx will run on
EXPOSE 8080

# Start Nginx
# Substitute into env.js, not index.html. The environment lives in its own
# file so the console needs no inline script and can run under a CSP with no
# 'unsafe-inline'; see public/env.js and .docker/nginx.conf.
CMD ["sh", "-c", "./import-meta-env-alpine -x .env -p /usr/share/nginx/html/env.js && nginx -g 'daemon off;'"]

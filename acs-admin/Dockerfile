# Stage 1: Build the application
FROM oven/bun:1.2.0 AS builder
ARG tag="(unknown version)"

# Set working directory
WORKDIR /app/acs-admin

# Copy package.json and install dependencies
COPY package.json bun.lock* ./
RUN --mount=type=bind,from=lib,dst=/app/lib bun install --production

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
CMD ["sh", "-c", "./import-meta-env-alpine -x .env -p /usr/share/nginx/html/index.html && nginx -g 'daemon off;'"]

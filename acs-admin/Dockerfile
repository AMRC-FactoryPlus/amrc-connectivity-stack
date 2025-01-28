# Stage 1: Build the application
FROM oven/bun:1.2.0 AS builder

# Set working directory
WORKDIR /app

# Copy package.json and install dependencies
COPY package.json bun.lockb ./
RUN bun install --production

# Copy the rest of the application code
COPY . .

# Build the application
RUN bun run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Copy the standalone binary to the image
COPY import-meta-env-alpine import-meta-env-alpine

# Make the binary executable
RUN chmod +x import-meta-env-alpine

# Copy built files from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration file
COPY .docker/nginx.conf /etc/nginx/conf.d/default.conf

# Expose the port Nginx will run on
EXPOSE 8080

# Start Nginx
CMD ["sh", "-c", "./import-meta-env-alpine -x .env -p /usr/share/nginx/html/index.html && nginx -g 'daemon off;'"]

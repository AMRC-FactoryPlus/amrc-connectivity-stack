FROM node:18-slim

WORKDIR /app

# Install Kerberos and build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    cmake \
    git \
    libkrb5-dev \
 && rm -rf /var/lib/apt/lists/*

# Install TypeScript globally (needed for gssapi.js build)
RUN npm install -g typescript

COPY package*.json ./

RUN npm install

COPY . .

USER node
EXPOSE 4840
CMD ["node", "bin/opcua-server.js"]

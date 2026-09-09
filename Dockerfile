# Use a slim Node.js (LTS) image as base
FROM node:24-slim

WORKDIR /app

# System dependencies + security upgrades, cleaned up in a single layer
# (tini = PID-1 init for signal handling / zombie reaping; replaces pm2)
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
    make \
    g++ \
    tini && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Upgrade global npm (patches CVEs in npm-bundled deps: tar, pacote, sigstore, ...)
RUN npm install -g npm@latest && \
    npm cache clean --force

# Install Python dependencies in a venv; upgrade pip+setuptools first (patches setuptools CVEs)
COPY requirements.txt /app/
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip setuptools && \
    pip install --no-cache-dir -r requirements.txt

# Copy package files and install node dependencies (production only)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Remove the build toolchain now that native modules are compiled
# (drops linux-libc-dev/binutils/g++/make/python3-dev -> ~1200 build-only CVEs)
RUN apt-get purge -y --auto-remove make g++ python3-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy application source code
COPY . .
RUN chmod +x start-services.sh

# Run as the image built-in non-root node user (uid 1000); give it ownership of /app
RUN mkdir -p /app/data && chown -R node:node /app
ENV HOME=/home/node

# Configure persistent data volume
VOLUME ["/app/data"]

# Configure application port (actual port set via PAPERLESS_AI_PORT)
EXPOSE ${PAPERLESS_AI_PORT:-3000}

# Health check (node-based; no curl dependency)
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:'+(process.env.PAPERLESS_AI_PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENV NODE_ENV=production
USER node

# tini as PID 1 (signal forwarding + zombie reaping); crash recovery via docker restart policy
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./start-services.sh"]

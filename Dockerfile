# ---------- builder ----------
# Chainguard/Wolfi glibc base. We use :latest deliberately: Chainguard rolling-
# patches these images and the free tier garbage-collects pinned digests (a
# digest pin would break future pulls). Language runtimes are pinned (nodejs-24,
# python-3.13) for stability; rebuild picks up upstream CVE patches automatically.
FROM cgr.dev/chainguard/wolfi-base:latest AS builder
WORKDIR /app

# Build toolchain (this stage is discarded; none of it ships in runtime)
RUN apk add --no-cache nodejs-24 npm python-3.13 python-3.13-dev py3.13-pip build-base bash

# Python deps in a venv; upgrade pip+setuptools first (patches setuptools CVEs)
COPY requirements.txt ./
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"
RUN pip install --no-cache-dir --upgrade pip setuptools && \
    pip install --no-cache-dir -r requirements.txt

# Node deps (compiles better-sqlite3 native module)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App source
COPY . .
RUN chmod +x start-services.sh

# ---------- runtime ----------
FROM cgr.dev/chainguard/wolfi-base:latest AS runtime
WORKDIR /app

# Runtime only: node + python + torch shared libs + tini + bash. NO npm / build
# tools -> keeps npm-core CVEs (tar/brace-expansion/ip-address/undici) out.
RUN apk add --no-cache nodejs-24 python-3.13 libstdc++ libgcc libgomp bash tini shadow && \
    useradd -u 1000 -m -d /home/appuser appuser

COPY --from=builder --chown=1000:1000 /app /app
RUN mkdir -p /app/data && chown -R appuser:appuser /app

ENV PATH="/app/venv/bin:$PATH" \
    HOME=/home/appuser \
    NODE_ENV=production \
    RAG_SERVICE_URL="http://localhost:8000" \
    RAG_SERVICE_ENABLED="true"

USER appuser
EXPOSE ${PAPERLESS_AI_PORT:-3000}

HEALTHCHECK --interval=30s --timeout=30s --start-period=10s --retries=3 \
    CMD node -e "require(\"http\").get(\"http://localhost:\"+(process.env.PAPERLESS_AI_PORT||3000)+\"/health\",r=>process.exit(r.statusCode===200?0:1)).on(\"error\",()=>process.exit(1))"

# tini as PID 1 (signal forwarding + zombie reaping); crash recovery via docker restart policy
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./start-services.sh"]

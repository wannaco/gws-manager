# ── GWS Admin Docker Image ──
# Multi-stage: builds the Go signer from source, downloads PocketBase, bundles the app.
#
# Build:  docker build -t gws-admin .
# Run:    docker run -p 8090:8090 -v gws-data:/app/data -e ENCRYPTION_KEY=... gws-admin

ARG PB_VERSION=0.39.0

# ─── Stage 1: Build the RS256 signer from source ──────────────────
# PocketBase 0.39 removed rsaSign, so JWT signing for Google service
# accounts is delegated to this small Go sidecar.
FROM golang:1.22-alpine AS signer-builder
WORKDIR /src
COPY sidecar/ ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /signer .

# ─── Stage 2: Runtime ─────────────────────────────────────────────
FROM alpine:3.21

ARG PB_VERSION
ARG TARGETARCH=amd64

RUN apk add --no-cache ca-certificates tzdata bash curl unzip && \
    adduser -D -h /app gws

# Download PocketBase at build time so no binary needs to live in the repo.
RUN curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" -o /tmp/pb.zip && \
    unzip -o /tmp/pb.zip -d /tmp/ && \
    mv /tmp/pocketbase /app/pocketbase && \
    chmod +x /app/pocketbase && \
    rm -f /tmp/pb.zip

# Signer binary (built from sidecar/main.go above)
COPY --from=signer-builder /signer /app/signer
RUN chmod +x /app/signer

# Application files
COPY frontend/ /app/frontend/
COPY hooks/    /app/hooks/
COPY lib/      /app/lib/
COPY backend/  /app/backend/

# Entrypoint (starts signer + PocketBase)
COPY scripts/docker-start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Data directory (mount a volume here at runtime)
RUN mkdir -p /app/data && chown -R gws:gws /app
USER gws
WORKDIR /app

EXPOSE 8090
CMD ["./start.sh"]

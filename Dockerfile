# ---- Stage 1: Build frontend ----
FROM oven/bun:1 AS frontend
WORKDIR /src

COPY frontend/package.json frontend/bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY frontend/ ./
RUN bun run build

# ---- Stage 2: Build backend ----
FROM golang:1.25-alpine AS backend
RUN apk add --no-cache build-base git
WORKDIR /src

# Download Go dependencies
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# Copy backend source and embed frontend build output
COPY backend/ ./
COPY --from=frontend /src/dist ./internal/web/dist

# Compile static binary
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/gitbase ./cmd/gitbase

# ---- Stage 3: Runtime ----
FROM alpine:3.22

# git: required for repo operations
# tini: lightweight init for proper signal handling and zombie reaping
RUN apk add --no-cache git ca-certificates tini

WORKDIR /app
COPY --from=backend /out/gitbase /app/gitbase

# Create non-root user and data directory
RUN addgroup -S gitbase && adduser -S -G gitbase gitbase && \
    mkdir -p /data && chown -R gitbase:gitbase /data

USER gitbase
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/gitbase"]

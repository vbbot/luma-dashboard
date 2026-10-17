# Two images from one file:
#   --target web      static dashboard served by nginx
#   --target backend  Convex backend that deploys convex/ on startup

# Convex backend release: https://github.com/get-convex/convex-backend/releases
ARG CONVEX_RELEASE=precompiled-2026-10-10-bb95347

# The built site is plain files, so build once on the native platform.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS web
# host:port of the backend API and its HTTP actions, as seen from this
# container. NGINX_ENTRYPOINT_LOCAL_RESOLVERS gives nginx the container's DNS
# servers, for looking the backend up per request.
ENV BACKEND_UPSTREAM=backend:3210 \
    SITE_UPSTREAM=backend:3211 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/entrypoint.sh /docker-entrypoint.d/40-luma-config.sh
RUN chmod +x /docker-entrypoint.d/40-luma-config.sh
COPY --from=build /app/dist /usr/share/nginx/html

# Convex CLI for the target platform (it ships native esbuild binaries).
FROM node:22-bookworm-slim AS convex-cli
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Ubuntu 24.04: the Convex release binary needs glibc 2.39.
FROM ubuntu:24.04 AS backend
ARG CONVEX_RELEASE
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) arch=x86_64 ;; \
      arm64) arch=aarch64 ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/backend.zip \
      "https://github.com/get-convex/convex-backend/releases/download/${CONVEX_RELEASE}/convex-local-backend-${arch}-unknown-linux-gnu.zip"; \
    unzip /tmp/backend.zip -d /usr/local/bin; \
    rm /tmp/backend.zip; \
    chmod +x /usr/local/bin/convex-local-backend

COPY --from=convex-cli /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=convex-cli /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY convex ./convex
COPY docker/backend/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/backend/admin-key.sh /usr/local/bin/admin-key
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/admin-key

VOLUME /convex/data
EXPOSE 3210 3211
HEALTHCHECK --interval=5s --start-period=60s \
  CMD test -f /tmp/ready && curl -fs http://localhost:3210/version
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

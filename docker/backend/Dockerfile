# Convex backend built from the precompiled release binary. The official
# ghcr.io/get-convex/convex-backend image is no longer published.
# Ubuntu 24.04: the release binary needs glibc 2.39.
FROM ubuntu:24.04

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

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY generate_admin_key.sh /convex/generate_admin_key.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /convex/generate_admin_key.sh

WORKDIR /convex
VOLUME /convex/data
EXPOSE 3210 3211
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Convex's admin UI (static export from the same release) with a proxy to
# the backend. Sign in with this container's own URL and an admin key.
FROM nginx:1.27-alpine

ARG CONVEX_RELEASE=precompiled-2026-10-10-bb95347

RUN set -eu; \
    apk add --no-cache curl unzip; \
    curl -fsSL -o /tmp/dashboard.zip \
      "https://github.com/get-convex/convex-backend/releases/download/${CONVEX_RELEASE}/dashboard.zip"; \
    rm -rf /usr/share/nginx/html/*; \
    unzip -q /tmp/dashboard.zip -d /usr/share/nginx/html; \
    rm /tmp/dashboard.zip; \
    apk del curl unzip

# host:port of the backend as seen from this container.
ENV BACKEND_UPSTREAM=backend:3210
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

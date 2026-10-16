# Convex's admin UI (static export from the same release). Sign in with the
# backend URL and CONVEX_ADMIN_KEY.
FROM nginx:1.27-alpine

ARG CONVEX_RELEASE

RUN set -eu; \
    apk add --no-cache curl unzip; \
    curl -fsSL -o /tmp/dashboard.zip \
      "https://github.com/get-convex/convex-backend/releases/download/${CONVEX_RELEASE}/dashboard.zip"; \
    rm -rf /usr/share/nginx/html/*; \
    unzip -q /tmp/dashboard.zip -d /usr/share/nginx/html; \
    rm /tmp/dashboard.zip; \
    apk del curl unzip

COPY nginx.conf /etc/nginx/conf.d/default.conf

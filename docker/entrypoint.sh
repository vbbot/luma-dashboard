#!/bin/sh
# Run by the nginx image before it starts. Writes the runtime config the
# frontend reads from window.__LUMA_CONFIG__. Leave CONVEX_URL unset to use
# the backend proxied on the same origin.
set -eu

url=$(printf '%s' "${CONVEX_URL:-}" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf 'window.__LUMA_CONFIG__ = { convexUrl: "%s" };\n' "$url" > /usr/share/nginx/html/config.js

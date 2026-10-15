#!/bin/sh
# Run by the nginx image before it starts. Writes the runtime config the
# frontend reads from window.__LUMA_CONFIG__.
set -eu

url=$(printf '%s' "${CONVEX_URL:-}" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf 'window.__LUMA_CONFIG__ = { convexUrl: "%s" };\n' "$url" > /usr/share/nginx/html/config.js

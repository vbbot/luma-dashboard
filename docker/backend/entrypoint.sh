#!/bin/sh
set -eu

if [ -z "${INSTANCE_SECRET:-}" ]; then
  echo "INSTANCE_SECRET is not set. Run ./setup.sh first." >&2
  exit 1
fi

mkdir -p /convex/data/storage
exec convex-local-backend \
  --interface 0.0.0.0 \
  --port 3210 \
  --site-proxy-port 3211 \
  --instance-name "$INSTANCE_NAME" \
  --instance-secret "$INSTANCE_SECRET" \
  --convex-origin "$CONVEX_CLOUD_ORIGIN" \
  --convex-site "$CONVEX_SITE_ORIGIN" \
  --local-storage /convex/data/storage \
  --disable-beacon \
  /convex/data/db.sqlite3

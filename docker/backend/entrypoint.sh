#!/bin/sh
# Starts the Convex backend, deploys the functions in /app/convex to it,
# then keeps running until the backend exits.
set -eu

DATA=/convex/data
mkdir -p "$DATA/storage"
ADMIN_KEY_SOURCED=1 . /usr/local/bin/admin-key

convex-local-backend \
  --interface 0.0.0.0 \
  --port 3210 \
  --site-proxy-port 3211 \
  --instance-name "$INSTANCE_NAME" \
  --instance-secret "$INSTANCE_SECRET" \
  --convex-origin "${CONVEX_CLOUD_ORIGIN:-http://127.0.0.1:3210}" \
  --convex-site "${CONVEX_SITE_ORIGIN:-http://127.0.0.1:3211}" \
  --local-storage "$DATA/storage" \
  --disable-beacon \
  "$DATA/db.sqlite3" &
backend=$!
trap 'kill -INT "$backend" 2>/dev/null' INT TERM

tries=0
until curl -fs http://127.0.0.1:3210/version >/dev/null; do
  kill -0 "$backend" 2>/dev/null || { wait "$backend"; exit $?; }
  tries=$((tries + 1))
  [ "$tries" -le 60 ] || { echo "Backend did not start" >&2; exit 1; }
  sleep 1
done

echo "Deploying functions"
if ! (cd /app && CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 \
  CONVEX_SELF_HOSTED_ADMIN_KEY="$(admin_key)" \
  ./node_modules/.bin/convex deploy --typecheck disable --codegen disable </dev/null); then
  kill -INT "$backend"
  exit 1
fi
touch /tmp/ready

wait "$backend"

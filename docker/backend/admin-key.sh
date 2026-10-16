#!/bin/sh
# Prints the admin key, e.g. for the Convex admin UI:
#   docker compose exec backend admin-key
# When sourced with ADMIN_KEY_SOURCED=1, only defines INSTANCE_NAME, INSTANCE_SECRET and admin_key.
set -eu

INSTANCE_NAME="${INSTANCE_NAME:-luma-dashboard}"
if [ -z "${INSTANCE_SECRET:-}" ]; then
  secret_file=/convex/data/instance_secret
  if [ ! -s "$secret_file" ]; then
    (umask 077 && node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))' > "$secret_file")
  fi
  INSTANCE_SECRET=$(cat "$secret_file")
fi
export INSTANCE_NAME INSTANCE_SECRET

admin_key() {
  convex-local-backend keygen admin-key \
    --instance-name "$INSTANCE_NAME" \
    --instance-secret "$INSTANCE_SECRET"
}

if [ -z "${ADMIN_KEY_SOURCED:-}" ]; then
  admin_key
fi

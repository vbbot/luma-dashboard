#!/bin/sh
# Prints an admin key for the Convex admin UI:
#   docker compose exec backend admin-key
# Keys are derived from INSTANCE_SECRET; every run prints a new, equally
# valid key. When sourced with ADMIN_KEY_SOURCED=1, only validates the
# environment and defines admin_key.
set -eu

INSTANCE_NAME="${INSTANCE_NAME:-luma-dashboard}"
case "${INSTANCE_SECRET:-}" in
  *[!0-9a-f]*|"")
    echo "INSTANCE_SECRET must be 64 lowercase hex characters. Generate one with: openssl rand -hex 32" >&2
    exit 1
    ;;
esac
if [ "${#INSTANCE_SECRET}" -ne 64 ]; then
  echo "INSTANCE_SECRET must be 64 lowercase hex characters. Generate one with: openssl rand -hex 32" >&2
  exit 1
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

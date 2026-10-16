#!/bin/sh
# Prints an admin key for this backend; used by ./setup.sh.
set -eu
exec convex-local-backend keygen admin-key \
  --instance-name "$INSTANCE_NAME" \
  --instance-secret "$INSTANCE_SECRET"

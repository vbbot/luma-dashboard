#!/bin/sh
# First-run setup: creates .env with a fresh instance secret, starts the
# backend, generates an admin key, then builds and starts everything.
# Safe to re-run; existing secrets are kept.
set -eu
cd "$(dirname "$0")"

if docker compose version >/dev/null 2>&1; then
  compose() { docker compose "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  compose() { docker-compose "$@"; }
else
  echo "Docker Compose not found. Install the compose plugin: https://docs.docker.com/compose/install/" >&2
  exit 1
fi

set_env() {
  # $1 = key, $2 = value. Values never contain '#'.
  sed -i.bak "s#^$1=.*#$1=$2#" .env && rm -f .env.bak
}

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env. Edit PUBLIC_BACKEND_URL so your phone can reach the backend."
fi

if ! grep -Eq '^INSTANCE_SECRET=.+' .env; then
  set_env INSTANCE_SECRET "$(openssl rand -hex 32)"
fi

compose up -d --wait backend

if ! grep -Eq '^CONVEX_ADMIN_KEY=.+' .env; then
  admin_key=$(compose exec -T backend ./generate_admin_key.sh | tail -n 1 | tr -d '\r')
  set_env CONVEX_ADMIN_KEY "$admin_key"
  echo "Generated admin key and saved it to .env."
fi

compose up -d --build

. ./.env
echo
echo "Dashboard: http://localhost:${WEB_PORT:-8080}"
echo "In Luma, set Server to: ${PUBLIC_BACKEND_URL}"

# Self-hosting

Two ways to run it: Railway's template (hosted, a few clicks) or Docker Compose on any machine.

## Railway

The template creates two services from the published images:

| Service | Image | Notes |
|---|---|---|
| `backend` | `ghcr.io/vbbot/luma-dashboard-backend` | Volume at `/convex/data`. No public domain. |
| `web` | `ghcr.io/vbbot/luma-dashboard-web` | Public domain on port 80. This is the URL you open and enter in Luma. |

It generates `INSTANCE_SECRET` and wires the services together, so there is nothing to fill in.
After deploying, open the `web` service's domain, create an account, and enter
`https://<that domain>` under **Server** on Luma's login screen.

To use your own domain, add it to `web`, set the backend's `CONVEX_CLOUD_ORIGIN` to the new
`https://` address, and redeploy. Reconnect Habitica afterwards so its webhook points at the new
address. Don't change `INSTANCE_SECRET` once there is data.

The admin UI (`convex-admin`) is not part of the template; it has full access to the backend and
is meant to stay off the internet.

## Docker Compose

On every start the backend deploys the dashboard functions, so updating the image updates them.

### Exposure

| Service | Listens on | Purpose |
|---|---|---|
| `web` | `WEB_PORT` (8080), all interfaces | `PUBLIC_URL`. Serves the dashboard and proxies **only** the Convex sync WebSocket (`/api/sync` for Luma, `/api/<version>/sync` for the dashboard) and lock screen webhooks (`POST`/`DELETE /hooks/<token>`). Every other `/api/` path, such as deploying code or exporting data, returns 404. |
| `convex-admin` | `127.0.0.1:6791` only | Convex's admin UI, with a proxy to the full backend API. |
| `backend` | not published | Reached only through the two containers above. |

For internet access, put `WEB_PORT` behind an HTTPS reverse proxy (Caddy, Traefik, nginx) with
WebSockets enabled, and use the `https://` address as `PUBLIC_URL`. Over plain `http` the
account number travels unencrypted.

An admin key can still talk to the backend over the public sync connection: it can read and
change data, but deploying code and the other admin endpoints are unreachable from outside.
Treat admin keys and `INSTANCE_SECRET` like root passwords.

### Admin UI

```sh
docker compose exec backend admin-key   # prints an admin key; each run prints a new valid one
```

Open http://127.0.0.1:6791 on the Docker host and sign in with `http://127.0.0.1:6791` as the
deployment URL and the printed key. From another machine, tunnel the port first:

```sh
ssh -L 6791:127.0.0.1:6791 user@docker-host
```

### Updating

Data lives in the `convex-data` volume. To update, `docker compose pull && docker compose up -d`.
Set `IMAGE_TAG` in `.env` to a release such as `0.1.0` to pin a version instead of `latest`.

### Images

| Image | Contents |
|---|---|
| `ghcr.io/vbbot/luma-dashboard-backend` | Convex backend (built from the pinned [release binary](https://github.com/get-convex/convex-backend/releases)) plus `convex/` |
| `ghcr.io/vbbot/luma-dashboard-web` | The built frontend on nginx, proxying the sync WebSocket to `BACKEND_UPSTREAM` (default `backend:3210`) and webhooks to `SITE_UPSTREAM` (default `backend:3211`). Has no URL baked in, so one image works for any deployment. |
| `ghcr.io/vbbot/luma-dashboard-convex-admin` | Convex's admin UI from the same release, proxying the full API to `BACKEND_UPSTREAM` |

All are built for `linux/amd64` and `linux/arm64` by
[`.github/workflows/docker.yml`](../.github/workflows/docker.yml): pushes to `main` publish
`latest`, tags like `v0.1.0` publish `0.1.0` and `0.1`, and pushes to any other branch publish an
image tagged with the branch name for testing (e.g. `IMAGE_TAG=integrations` in `.env`).

To build them from a checkout instead:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Accounts and the captcha

As on the hosted dashboard, an account is just a random 16-digit number, generated in the browser
with `crypto.getRandomValues`. Anyone who knows the number can read and change the account, and
there is no recovery.

Logging in and creating an account both need an [ALTCHA](https://altcha.org) captcha: an
"I'm not a robot" checkbox that makes the browser solve a short proof-of-work, with no third-party
service. The backend issues signed challenges (`captcha:challenge`), checks the solution in
`accounts:logIn` and `accounts:create`, and accepts each solution only once. The Docker backend
derives the signing key from `INSTANCE_SECRET`; nothing needs configuring.

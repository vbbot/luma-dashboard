FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# One-shot job: pushes convex/ (schema + functions) to the backend, then exits.
FROM deps AS deploy
COPY tsconfig.json ./
COPY convex ./convex
CMD ["sh", "-c", "if [ -z \"${CONVEX_SELF_HOSTED_ADMIN_KEY:-}\" ]; then echo 'CONVEX_ADMIN_KEY is not set. Run ./setup.sh first.' >&2; exit 1; fi; exec npx convex deploy"]

FROM deps AS build
COPY . .
RUN npm run build

# Static web dashboard. The backend URL is injected at container start
# (CONVEX_URL), so one image works for any deployment.
FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /docker-entrypoint.d/40-luma-config.sh
RUN chmod +x /docker-entrypoint.d/40-luma-config.sh
COPY --from=build /app/dist /usr/share/nginx/html

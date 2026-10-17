# Development

```sh
npm install
npx convex dev        # runs a local backend and redeploys convex/ on save
npx convex env set ALTCHA_HMAC_KEY "$(openssl rand -hex 32)"   # once, for the login captcha
npx convex env set INTEGRATIONS_KEY "$(openssl rand -hex 32)"  # once, encrypts integration credentials
npm run dev           # in another terminal; http://localhost:5173
```

`npx convex dev` writes `VITE_CONVEX_URL` to `.env.local`, which the frontend picks up. To test
with a real phone, point Luma's Server setting at `http://<your-computer's-LAN-IP>:3210`.

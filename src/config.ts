declare global {
  interface Window {
    __LUMA_CONFIG__?: { convexUrl?: string };
  }
}

// In production the backend is proxied on the same origin as the page.
export const convexUrl = (
  window.__LUMA_CONFIG__?.convexUrl ||
  import.meta.env.VITE_CONVEX_URL ||
  window.location.origin
).replace(/\/$/, "");

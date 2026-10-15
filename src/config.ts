declare global {
  interface Window {
    __LUMA_CONFIG__?: { convexUrl?: string };
  }
}

export const convexUrl = (
  window.__LUMA_CONFIG__?.convexUrl ||
  import.meta.env.VITE_CONVEX_URL ||
  ""
).replace(/\/$/, "");

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App } from "./App";
import { convexUrl } from "./config";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

if (convexUrl === "") {
  root.render(
    <p className="fatal">
      No server configured. Set CONVEX_URL on the container, or VITE_CONVEX_URL in .env.local for
      development.
    </p>,
  );
} else {
  const convex = new ConvexReactClient(convexUrl);
  root.render(
    <StrictMode>
      <ConvexProvider client={convex}>
        <App />
      </ConvexProvider>
    </StrictMode>,
  );
}

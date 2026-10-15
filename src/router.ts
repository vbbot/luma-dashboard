import { useEffect, useState } from "react";

// Hash routing keeps the static build servable from any path without
// server-side rewrites.
function currentPath(): string {
  return window.location.hash.replace(/^#/, "") || "/";
}

export function useRoute(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => {
      setPath(currentPath());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return path;
}

export function navigate(path: string) {
  window.location.hash = path;
}


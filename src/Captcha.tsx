import { useEffect, useRef } from "react";
import { useAction } from "convex/react";
import "altcha";
import type {} from "altcha/types/react";
import { api } from "../convex/_generated/api";
import type { CaptchaPayload } from "../convex/captcha";

// ALTCHA's "I'm not a robot" checkbox. Challenges come from the captcha:
// challenge action, since the backend is reachable only over the sync
// WebSocket. Calls onChange with the solved payload, or null when it is
// cleared or expires. Remount (change the key) to get a fresh challenge.
export function Captcha({ onChange }: { onChange: (payload: CaptchaPayload | null) => void }) {
  const ref = useRef<HTMLElementTagNameMap["altcha-widget"]>(null);
  const challenge = useAction(api.captcha.challenge);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const widget = ref.current;
    if (!widget) return;
    // The widget's methods exist only once it has loaded.
    const configure = () =>
      void widget.configure({
        challenge: "/captcha",
        fetch: async () =>
          new Response(JSON.stringify(await challenge()), {
            headers: { "content-type": "application/json" },
          }),
        hideLogo: true,
        hideFooter: true,
      });
    if (typeof widget.configure === "function") configure();
    else widget.addEventListener("load", configure, { once: true });
    const listener = (event: Event) => {
      const { state, payload } = (event as CustomEvent<{ state: string; payload: string | null }>)
        .detail;
      onChangeRef.current(
        state === "verified" && payload ? (JSON.parse(atob(payload)) as CaptchaPayload) : null,
      );
    };
    widget.addEventListener("statechange", listener);
    return () => {
      widget.removeEventListener("load", configure);
      widget.removeEventListener("statechange", listener);
    };
  }, [challenge]);

  return <altcha-widget ref={ref} className="captcha" name="captcha" />;
}

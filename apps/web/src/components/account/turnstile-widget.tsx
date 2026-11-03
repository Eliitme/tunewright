/** Cloudflare Turnstile, loaded on demand with explicit rendering. Calls onToken with each fresh token. */
import { useEffect, useRef, useState } from "react";
import { appEnvironment } from "../../config/app-environment.ts";

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile failed to load")));
    script.onerror = () => {
      loading = null;
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function TurnstileWidget({ onToken }: { onToken(token: string | null): void }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(onToken);
  latest.current = onToken;

  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !box.current) return;
        id = ts.render(box.current, {
          sitekey: appEnvironment.turnstileSiteKey,
          theme: "auto",
          callback: (token: string) => latest.current(token),
          "expired-callback": () => latest.current(null),
          "error-callback": () => latest.current(null),
        });
      })
      .catch(() => {
        // Retry on the next mount; a blocked script (ad blocker, network) must not stick for the session.
        loading = null;
        setFailed(true);
        latest.current(null);
      });
    return () => {
      cancelled = true;
      if (id) window.turnstile?.remove(id);
    };
  }, []);

  if (failed) return <p className="text-sm text-warn">The captcha could not load. Disable content blockers for this site, then reopen this dialog.</p>;
  return <div ref={box} className="min-h-[65px]" />;
}

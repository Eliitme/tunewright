/**
 * Landing page of the emailed sign-in link. The token is taken out of the URL
 * at once, and only redeemed when the person clicks, so mail scanners that
 * open links (e.g. Outlook Safe Links) cannot use it up.
 */
import { useState } from "react";
import { GlassPanel } from "../components/glassyui/glass-panel.tsx";
import { Button } from "../components/ui-primitives.tsx";
import { describeApiError, useAuthStore } from "../sync/auth-session.ts";

/** Reads `#t=<token>` once and scrubs it from the address bar and history. */
function takeTokenFromUrl(): string | null {
  const token = new URLSearchParams(location.hash.slice(1)).get("t");
  if (location.hash) history.replaceState(null, "", location.pathname);
  return token && /^[A-Za-z0-9_-]{20,128}$/.test(token) ? token : null;
}

export function AuthVerifyPage() {
  const [token] = useState(takeTokenFromUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await useAuthStore.getState().verifyLinkToken(token);
      location.replace("/");
    } catch (e) {
      setError(describeApiError(e));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <GlassPanel variant="card" className="w-full max-w-sm space-y-4 p-6 text-center">
        <h1 className="text-lg font-semibold">Sign in to Tunewright</h1>
        {token ? (
          <>
            <p className="text-sm text-muted">Confirm to finish signing in on this browser.</p>
            <Button variant="primary" className="w-full" disabled={busy} onClick={() => void confirm()}>
              {busy ? "Signing in…" : "Confirm sign-in"}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted">This sign-in link is incomplete. Request a new one from the app, or enter the 6-digit code from the email.</p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <a className="block text-xs text-muted hover:text-fg" href="/">Back to the editor</a>
      </GlassPanel>
    </main>
  );
}

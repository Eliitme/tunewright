/** Email sign-in: send a link + code (behind Turnstile), then enter the code or open the link. */
import { useState } from "react";
import { GlassDialog, GlassDialogContent, GlassDialogTitle } from "../glassyui/glass-dialog.tsx";
import { GlassInput } from "../glassyui/glass-input.tsx";
import { Button } from "../ui-primitives.tsx";
import { describeApiError, useAuthStore } from "../../sync/auth-session.ts";
import { TurnstileWidget } from "./turnstile-widget.tsx";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { requestLogin, verifyCode } = useAuthStore.getState();
  const [email, setEmail] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A Turnstile token is single use; remount the widget for every attempt.
  const [captchaRound, setCaptchaRound] = useState(0);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setSent(false);
    setCaptcha(null);
    setCaptchaRound((n) => n + 1);
    setCode("");
    setError(null);
    onClose();
  };
  const send = () =>
    run(async () => {
      try {
        await requestLogin(email.trim(), captcha!);
        setSent(true);
      } finally {
        setCaptcha(null);
        setCaptchaRound((n) => n + 1);
      }
    });
  const verify = () => run(async () => (await verifyCode(email.trim(), code), close()));

  return (
    <GlassDialog open={open} onOpenChange={(next) => !next && close()}>
      <GlassDialogContent className="w-[min(92vw,420px)] p-6" aria-describedby={undefined}>
        <GlassDialogTitle className="mb-1 pr-10 text-lg font-semibold">Sign in to sync presets</GlassDialogTitle>
        <p className="mb-4 text-sm text-muted">No password: we email you a sign-in link and a 6-digit code.</p>
        {!sent ? (
          <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), void send())}>
            <GlassInput type="email" autoComplete="email" aria-label="Email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            <TurnstileWidget key={captchaRound} onToken={setCaptcha} />
            <Button type="submit" variant="primary" className="w-full" disabled={busy || !captcha || !EMAIL.test(email.trim())}>
              {busy ? "Sending…" : "Email me a sign-in link"}
            </Button>
          </form>
        ) : (
          <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), void verify())}>
            <p className="text-sm">
              Sent to <strong>{email.trim()}</strong>. Open the link in the email, or enter the code here.
            </p>
            <GlassInput
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="6-digit code"
              placeholder="123456"
              maxLength={6}
              className="text-center text-lg tracking-[0.4em] tabular-nums"
              value={code}
              onChange={(e) => setCode(e.currentTarget.value.replace(/\D/g, ""))}
            />
            <Button type="submit" variant="primary" className="w-full" disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Sign in"}
            </Button>
            <button type="button" className="w-full text-center text-xs text-muted hover:text-fg" onClick={() => setSent(false)}>
              Use a different email or resend
            </button>
          </form>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </GlassDialogContent>
    </GlassDialog>
  );
}

/** Server-side check of a Cloudflare Turnstile token. */
export type TurnstileVerifier = (token: string, ip: string | null) => Promise<boolean>;

export function turnstileVerifier(secret: string): TurnstileVerifier {
  return async (token, ip) => {
    if (!token || token.length > 2048) return false;
    const body = new FormData();
    body.append("secret", secret);
    body.append("response", token);
    if (ip) body.append("remoteip", ip);
    try {
      const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      return false;
    }
  };
}

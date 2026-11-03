/** Random secrets and the hashes stored in place of them. */
const encoder = new TextEncoder();

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 256-bit URL-safe secret (magic link token, session token). */
export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Uniform 6-digit code (rejection sampling avoids modulo bias). */
export function randomCode(): string {
  const limit = 4_294_000_000; // largest multiple of 1e6 below 2^32
  for (;;) {
    const [v] = crypto.getRandomValues(new Uint32Array(1));
    if (v! < limit) return String(v! % 1_000_000).padStart(6, "0");
  }
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Unguessable public share slug (16 chars ≈ 95 bits). */
export function randomSlug(length = 16): string {
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < 248 && out.length < length) out += BASE62[b % 62];
    }
  }
  return out;
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/** base64url(SHA-256(value)), the PKCE S256 form used for the native app's challenge. */
export async function sha256Base64Url(value: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function hmacHex(key: string, value: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", k, encoder.encode(value)));
}

export function timingSafeEqualStrings(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

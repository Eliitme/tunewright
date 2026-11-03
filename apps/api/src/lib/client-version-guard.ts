/** Rejects clients older than MIN_CLIENT_VERSION with 426 so old wire formats can be retired. */
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env.ts";

const parse = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);

export function isAtLeast(version: string, minimum: string): boolean {
  const a = parse(version);
  const b = parse(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return true;
}

export const clientVersionGuard = createMiddleware<AppEnv>(async (c, next) => {
  const version = c.req.header("X-Client-Version") ?? "";
  if (!isAtLeast(version, c.env.MIN_CLIENT_VERSION)) {
    return c.json({ error: "client_outdated", minimum: c.env.MIN_CLIENT_VERSION }, 426);
  }
  await next();
});

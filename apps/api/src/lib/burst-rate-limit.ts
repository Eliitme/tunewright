/** Per-IP burst limit using a Workers Rate Limiting binding (counted per location). */
import { createMiddleware } from "hono/factory";
import type { AppEnv, Env } from "../env.ts";

export const burstRateLimit = (binding: "AUTH_LIMITER" | "SHARE_LIMITER") =>
  createMiddleware<AppEnv>(async (c, next) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const { success } = await (c.env as Env)[binding].limit({ key: ip });
    if (!success) return c.json({ error: "rate_limited" }, 429);
    await next();
  });

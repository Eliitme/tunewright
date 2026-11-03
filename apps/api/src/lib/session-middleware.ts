/** Resolves `Authorization: Bearer <session token>` to the signed-in user, or answers 401. */
import { createMiddleware } from "hono/factory";
import { now, type AppEnv } from "../env.ts";
import { touchSession } from "../db/user-session-repository.ts";
import { sha256Hex } from "./token-hashing.ts";

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const match = /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(c.req.header("Authorization") ?? "");
  if (!match) return c.json({ error: "unauthorized" }, 401);
  const sessionHash = await sha256Hex(match[1]!);
  const user = await touchSession(c.env.DB, sessionHash, now());
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  c.set("sessionHash", sessionHash);
  await next();
});

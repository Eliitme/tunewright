/** HTTP app: CORS, body limit, version gate, rate limits, then the route groups. */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { AppDeps } from "./app-deps.ts";
import type { AppEnv } from "./env.ts";
import { burstRateLimit } from "./lib/burst-rate-limit.ts";
import { clientVersionGuard } from "./lib/client-version-guard.ts";
import { requireSession } from "./lib/session-middleware.ts";
import { authRoutes } from "./routes/auth-routes.ts";
import { presetRoutes } from "./routes/preset-routes.ts";
import { publicShareRoutes, shareOwnerRoutes } from "./routes/share-routes.ts";

export const MAX_BODY_BYTES = 16 * 1024;

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use(
    "*",
    cors({
      origin: (origin, c) => (c.env.WEB_ORIGINS.split(",").map((o: string) => o.trim()).includes(origin) ? origin : null),
      allowHeaders: ["Authorization", "Content-Type", "X-Client-Version"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );
  app.use("*", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "body_too_large" }, 413) }));

  app.use("/s/*", burstRateLimit("SHARE_LIMITER"));
  app.route("/s", publicShareRoutes());

  app.use("/auth/*", burstRateLimit("AUTH_LIMITER"), clientVersionGuard);
  app.route("/auth", authRoutes(deps));

  app.use("/me", clientVersionGuard, requireSession);
  app.get("/me", (c) => c.json({ user: c.get("user") }));

  // In Hono "/presets/*" also matches "/presets" itself.
  app.use("/presets/*", clientVersionGuard, requireSession);
  app.route("/presets", shareOwnerRoutes());
  app.route("/presets", presetRoutes());

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  // Log only the error itself (never bodies, emails or tokens) and never echo internals.
  app.onError((err, c) => {
    console.error(`${c.req.method} ${c.req.path}: ${err.name}: ${err.message}`);
    return c.json({ error: "internal" }, 500);
  });

  return app;
}

/** Worker entry: HTTP API plus a daily cleanup of expired logins, sessions and old tombstones. */
import { createApp } from "./app.ts";
import { productionDeps } from "./app-deps.ts";
import { now, type Env } from "./env.ts";
import { purgeExpired } from "./db/preset-repository.ts";

const app = createApp(productionDeps);

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(purgeExpired(env.DB, now()));
  },
} satisfies ExportedHandler<Env>;

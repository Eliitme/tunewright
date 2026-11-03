import type { D1Migration } from "cloudflare:test";
import type { Env as AppBindings } from "../src/env.ts";

declare global {
  namespace Cloudflare {
    interface Env extends AppBindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

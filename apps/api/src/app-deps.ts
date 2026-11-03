/** Outside services the routes call; tests swap these for fakes. */
import type { Env } from "./env.ts";
import { emailBindingMailer, type Mailer } from "./lib/magic-link-email.ts";
import { turnstileVerifier, type TurnstileVerifier } from "./lib/turnstile-verify.ts";

export interface AppDeps {
  mailer(env: Env): Mailer;
  turnstile(env: Env): TurnstileVerifier;
}

export const productionDeps: AppDeps = {
  mailer: emailBindingMailer,
  turnstile: (env) => turnstileVerifier(env.TURNSTILE_SECRET),
};

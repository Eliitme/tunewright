/**
 * Signed-in account and background preset sync. The session token lives in
 * localStorage (the API uses bearer tokens, not cookies); a strict CSP and the
 * server's 90-day session limit bound the damage if it ever leaks.
 */
import { create } from "zustand";
import { readJson, writeJson } from "../lib/safe-local-storage.ts";
import { usePresetStore, type PresetStore } from "../state/preset-store.ts";
import { ApiError, apiFetch, type ApiFetch } from "./api-client.ts";
import { adoptLocalPresets, syncOnce, type SyncTarget } from "./preset-sync-engine.ts";

export interface Account {
  id: string;
  email: string;
}

interface StoredSession {
  token: string;
  user: Account;
}

type SyncStatus = "idle" | "syncing" | "offline" | "error";

export interface AuthState {
  session: StoredSession | null;
  syncStatus: SyncStatus;
  /** The API no longer accepts this build; a reload is needed. */
  outdated: boolean;
  /** Local-only presets waiting for the user to decide whether they join the account. */
  adoptableCount: number;
  notice: string | null;
  requestLogin(email: string, turnstileToken: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  verifyLinkToken(token: string): Promise<void>;
  adoptLocal(accept: boolean): void;
  logout(everywhere?: boolean): Promise<void>;
  syncNow(): Promise<void>;
  setNotice(notice: string | null): void;
}

const SESSION_KEY = "tunewright.session.v1";
const revKey = (userId: string) => `tunewright.sync.${userId}.rev`;
/** Set at sign-in when this browser has local-only presets; the offer is shown after the first successful sync. */
const adoptKey = (userId: string) => `tunewright.sync.${userId}.adopt-offer`;
const SYNC_LOCK = "tunewright-preset-sync";

/** Only one tab syncs at a time (all tabs share the cache and the sync position). */
function withSyncLock(task: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? locks.request(SYNC_LOCK, () => task()).then(() => undefined) : task();
}

const isSession = (s: unknown): s is StoredSession =>
  !!s && typeof (s as StoredSession).token === "string" && typeof (s as StoredSession).user?.id === "string";

const ERROR_TEXT: Record<string, string> = {
  captcha_failed: "The captcha check failed. Please try again.",
  invalid_or_expired: "That code or link is wrong or has expired. Request a new one.",
  too_many_attempts: "Too many wrong codes. Try again in an hour.",
  rate_limited: "Too many requests. Wait a minute and try again.",
  mail_failed: "The sign-in email could not be sent. Try again later.",
  offline: "Can't reach the sync server. Check your connection.",
};
export const describeApiError = (e: unknown) =>
  e instanceof ApiError ? (ERROR_TEXT[e.message] ?? `Request failed (${e.message})`) : (e as Error).message;

/**
 * The engine's view of the cache. Writes for any account other than the signed-in one are ignored,
 * so a round that outlives its session (sign-out mid-sync) cannot bring that account's presets back.
 */
export function presetSyncTarget(store: { getState(): PresetStore }): SyncTarget {
  const forCurrentAccount = (owner: string | null) => owner === null || owner === store.getState().account;
  return {
    all: () => store.getState().presets,
    put: (item) => forCurrentAccount(item.owner) && store.getState().putSynced(item),
    drop: (id) => {
      const item = store.getState().presets.find((p) => p.id === id);
      if (item && forCurrentAccount(item.owner)) store.getState().dropSynced(id);
    },
  };
}

export function createAuthStore(api: ApiFetch, presets: typeof usePresetStore) {
  const target = presetSyncTarget(presets);
  let running: Promise<void> | null = null;
  let again = false;

  return create<AuthState>((set, get) => {
    const initial = readJson<unknown>(SESSION_KEY, null);
    const session = isSession(initial) ? initial : null;
    presets.getState().setAccount(session?.user.id ?? null);

    const countAdoptable = () => presets.getState().presets.filter((p) => p.owner === null).length;

    async function signedIn(result: StoredSession) {
      const previous = get().session;
      if (previous && previous.user.id !== result.user.id) {
        // Switching accounts (e.g. a magic link for someone else): end the old session properly first.
        await api("/auth/logout", { method: "POST", token: previous.token }).catch(() => undefined);
        signedOut(null);
      }
      writeJson(SESSION_KEY, result);
      if (countAdoptable() > 0) writeJson(adoptKey(result.user.id), true);
      presets.getState().setAccount(result.user.id);
      set({ session: result, notice: null });
      await get().syncNow();
    }

    /**
     * Removes this account's synced presets from the browser so the next person does not see them.
     * Presets with changes the server has not seen are kept, hidden, until the same account signs in again.
     */
    function signedOut(notice: string | null) {
      const userId = get().session?.user.id;
      writeJson(SESSION_KEY, null);
      presets.getState().setAccount(null);
      if (userId) {
        for (const p of presets.getState().presets) if (p.owner === userId && !p.dirty) presets.getState().dropSynced(p.id);
        writeJson(revKey(userId), 0);
      }
      set({ session: null, syncStatus: "idle", adoptableCount: 0, notice });
    }

    /** Shows the "add this browser's presets" offer once the account's presets are known (for de-duplication). */
    function offerAdoptionIfPending(userId: string) {
      if (!readJson<boolean>(adoptKey(userId), false)) return;
      const count = countAdoptable();
      if (count === 0) writeJson(adoptKey(userId), false);
      set({ adoptableCount: count });
    }

    async function runSync() {
      const current = get().session;
      if (!current) return;
      set({ syncStatus: "syncing" });
      try {
        let result: Awaited<ReturnType<typeof syncOnce>> | null = null;
        await withSyncLock(async () => {
          if (get().session !== current) return;
          // Another tab may have advanced the cache meanwhile.
          presets.getState().reload();
          result = await syncOnce(api, current.token, current.user.id, target, readJson<number>(revKey(current.user.id), 0));
          if (get().session === current) writeJson(revKey(current.user.id), result.lastRev);
        });
        if (get().session !== current || !result) return;
        const { conflicts } = result as Awaited<ReturnType<typeof syncOnce>>;
        set({ syncStatus: "idle", ...(conflicts.length > 0 && { notice: `Changed on another device: kept your version of ${conflicts.map((n) => `“${n}”`).join(", ")} as a “(conflict)” copy.` }) });
        offerAdoptionIfPending(current.user.id);
      } catch (error) {
        if (get().session !== current) return;
        if (error instanceof ApiError && error.status === 401) return signedOut("Your session ended. Sign in again to keep syncing.");
        if (error instanceof ApiError && error.status === 426) return set({ outdated: true, syncStatus: "error" });
        const offline = error instanceof ApiError && error.status === 0;
        set({ syncStatus: offline ? "offline" : "error" });
      }
    }

    return {
      session,
      syncStatus: "idle",
      outdated: false,
      adoptableCount: 0,
      notice: null,

      async requestLogin(email, turnstileToken) {
        await api("/auth/request", { method: "POST", body: { client: "web", email, turnstileToken } });
      },
      async verifyCode(email, code) {
        await signedIn(await api<{ sessionToken: string; user: Account }>("/auth/verify", { method: "POST", body: { email, code } }).then(toSession));
      },
      async verifyLinkToken(token) {
        await signedIn(await api<{ sessionToken: string; user: Account }>("/auth/verify", { method: "POST", body: { token } }).then(toSession));
      },

      adoptLocal(accept) {
        const userId = get().session?.user.id;
        set({ adoptableCount: 0 });
        if (userId) writeJson(adoptKey(userId), false);
        if (!accept || !userId) return;
        const n = adoptLocalPresets(target, userId);
        if (n > 0) void get().syncNow();
      },

      async logout(everywhere = false) {
        const token = get().session?.token;
        // Push pending changes first so signing out does not leave them stranded.
        await get().syncNow().catch(() => undefined);
        // Sign out locally even if the server can't be reached.
        if (token) await api(everywhere ? "/auth/logout-all" : "/auth/logout", { method: "POST", token }).catch(() => undefined);
        signedOut(null);
      },

      /** Single flight: requests during a running round collapse into exactly one more round. */
      syncNow() {
        if (running) {
          again = true;
          return running;
        }
        running = (async () => {
          do {
            again = false;
            await runSync();
          } while (again);
        })().finally(() => (running = null));
        return running;
      },

      setNotice: (notice) => set({ notice }),
    };
  });
}

const toSession = (r: { sessionToken: string; user: Account }): StoredSession => ({ token: r.sessionToken, user: { id: r.user.id, email: r.user.email } });

export const useAuthStore = createAuthStore(apiFetch, usePresetStore);

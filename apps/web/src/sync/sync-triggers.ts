/** When to sync: after local edits (debounced), on focus, when back online, and every minute. */
import { PRESETS_STORAGE_KEY, usePresetStore } from "../state/preset-store.ts";
import { useAuthStore } from "./auth-session.ts";

const EDIT_DEBOUNCE_MS = 1500;
const POLL_MS = 60_000;

export function startSyncTriggers(): () => void {
  const sync = () => {
    if (useAuthStore.getState().session && navigator.onLine) void useAuthStore.getState().syncNow();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = usePresetStore.subscribe((s, prev) => {
    if (s.presets === prev.presets || !s.account) return;
    if (!s.presets.some((p) => p.dirty && p.owner === s.account)) return;
    clearTimeout(timer);
    timer = setTimeout(sync, EDIT_DEBOUNCE_MS);
  });
  const onVisible = () => document.visibilityState === "visible" && sync();
  // Another tab wrote presets: pick them up so this tab never saves a stale list over them.
  const onStorage = (e: StorageEvent) => e.key === PRESETS_STORAGE_KEY && usePresetStore.getState().reload();
  addEventListener("storage", onStorage);
  addEventListener("online", sync);
  document.addEventListener("visibilitychange", onVisible);
  const poll = setInterval(sync, POLL_MS);
  sync();
  return () => {
    unsubscribe();
    clearTimeout(timer);
    clearInterval(poll);
    removeEventListener("online", sync);
    removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/**
 * One sync round for the signed-in account: pull changes since the last seen
 * server revision, then push local changes with the revision they were based on.
 *
 * Conflicts follow one rule: the server copy wins, and a locally edited copy is
 * kept as a new preset named "<name> (conflict)" so no edit is ever lost.
 * Entries are read fresh and patched one at a time, so edits made while a
 * round is running are never overwritten.
 */
import { safeParsePreset, type EqPreset } from "@tunewright/walkplay-protocol";
import { ApiError, type ApiFetch } from "./api-client.ts";
import type { StoredPreset } from "../state/preset-store.ts";

export interface RemoteItem {
  id: string;
  rev: number;
  updatedAt: number;
  deleted: boolean;
  data: unknown;
}

interface PresetPage {
  items: RemoteItem[];
  nextRev: number;
  hasMore: boolean;
}

export interface SyncTarget {
  all(): StoredPreset[];
  put(item: StoredPreset): void;
  drop(id: string): void;
}

export interface SyncResult {
  lastRev: number;
  /** Names of presets whose local edits were kept as "(conflict)" copies. */
  conflicts: string[];
}

const MAX_NAME = 64;
const SUFFIX = " (conflict)";
const conflictName = (name: string) => {
  const base = name.endsWith(SUFFIX) ? name.slice(0, -SUFFIX.length) : name;
  return `${base.slice(0, MAX_NAME - SUFFIX.length)}${SUFFIX}`;
};

export async function syncOnce(api: ApiFetch, token: string, userId: string, target: SyncTarget, lastRev: number): Promise<SyncResult> {
  const conflicts: string[] = [];
  const find = (id: string) => target.all().find((p) => p.id === id);
  const mine = () => target.all().filter((p) => p.owner === userId);

  /** Brings one server item into the local cache, saving local edits that would be overwritten. */
  const applyRemote = (item: RemoteItem) => {
    const local = find(item.id);
    if (local && local.owner !== userId) return; // id clash with a preset of another account: leave it alone
    if (local?.rev === item.rev) return; // our own write coming back
    const parsed = item.deleted ? null : safeParsePreset(item.data);
    if (parsed && !parsed.success) return; // a newer client's format we cannot read; keep what we have
    // A lost upload response comes back as a "remote" change with our own content: not a conflict.
    const sameContent = !!parsed?.success && !!local && presetFingerprint(parsed.data) === presetFingerprint(local.preset);
    if (local?.dirty && !local.deleted && !sameContent) {
      conflicts.push(local.preset.name);
      target.put({ ...local, id: crypto.randomUUID(), preset: { ...local.preset, name: conflictName(local.preset.name) }, rev: 0, dirty: true });
    }
    if (item.deleted || !parsed) {
      if (local) target.drop(item.id);
      return;
    }
    target.put({ id: item.id, preset: parsed.data, updatedAt: Date.now(), owner: userId, rev: item.rev, dirty: false, deleted: false });
  };

  // Pull. A 410 means tombstones we never saw were cleaned up: pull everything and drop what the server no longer has.
  let since = lastRev;
  let fullResync = since === 0;
  const seen = new Set<string>();
  for (;;) {
    let page: PresetPage;
    try {
      page = await api<PresetPage>(`/presets?sinceRev=${since}&limit=100`, { token });
    } catch (error) {
      if (error instanceof ApiError && error.status === 410 && since !== 0) {
        since = 0;
        fullResync = true;
        continue;
      }
      throw error;
    }
    for (const item of page.items) {
      seen.add(item.id);
      applyRemote(item);
    }
    since = page.nextRev;
    if (!page.hasMore) break;
  }
  if (fullResync) {
    for (const p of mine()) if (p.rev > 0 && !p.dirty && !seen.has(p.id)) target.drop(p.id);
  }

  // Push. Each entry is re-read right before and after its request, so the user's latest edit always wins locally.
  for (const id of mine().filter((p) => p.dirty).map((p) => p.id)) {
    const item = find(id);
    if (!item || !item.dirty || item.owner !== userId) continue;
    if (item.deleted && item.rev === 0) {
      target.drop(item.id);
      continue;
    }
    try {
      if (item.deleted) {
        await api(`/presets/${item.id}`, { method: "DELETE", body: { baseRev: item.rev }, token });
        target.drop(item.id);
        continue;
      }
      const saved = await api<RemoteItem>(`/presets/${item.id}`, { method: "PUT", body: { data: item.preset, baseRev: item.rev }, token });
      const now = find(item.id);
      // If it was edited again while the request was in flight, keep it dirty against the new revision.
      if (now) target.put({ ...now, rev: saved.rev, dirty: now.updatedAt !== item.updatedAt || now.deleted, syncError: undefined });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      const now = find(item.id);
      if (error.status === 409 && error.body.current) applyRemote(error.body.current as RemoteItem);
      else if (!now) continue;
      else if (error.status === 404) {
        // Gone on the server (cleaned-up tombstone): a delete is done, an edit becomes a new upload.
        if (now.deleted) target.drop(now.id);
        else target.put({ ...now, rev: 0 });
      } else if (error.status === 422 || error.status === 400) {
        target.put({ ...now, syncError: error.status === 422 ? "Account preset limit reached" : "Rejected by the server" });
      } else throw error; // offline, 401, 426, 5xx: stop this round
    }
  }
  return { lastRev: since, conflicts };
}

/** Stable content fingerprint used to avoid uploading duplicates of presets the account already has. */
export function presetFingerprint(p: EqPreset): string {
  const bands = p.bands.map((b) => [b.type, b.freq, +b.q.toFixed(3), +b.gain.toFixed(2)]);
  return JSON.stringify([p.name.trim().toLowerCase(), p.preamp, p.filterMode ?? null, bands]);
}

/** Hands local-only presets to the account, skipping ones it already has. Returns how many were adopted. */
export function adoptLocalPresets(target: SyncTarget, userId: string): number {
  const existing = new Set(target.all().filter((p) => p.owner === userId && !p.deleted).map((p) => presetFingerprint(p.preset)));
  let adopted = 0;
  for (const p of target.all().filter((x) => x.owner === null)) {
    const fp = presetFingerprint(p.preset);
    if (existing.has(fp)) {
      target.drop(p.id);
      continue;
    }
    existing.add(fp);
    target.put({ ...p, owner: userId, rev: 0, dirty: true, deleted: false });
    adopted++;
  }
  return adopted;
}

import { describe, expect, it } from "vitest";
import type { EqPreset } from "@tunewright/walkplay-protocol";
import { ApiError, type ApiFetch, type ApiRequest } from "../sync/api-client.ts";
import { adoptLocalPresets, syncOnce, type RemoteItem, type SyncTarget } from "../sync/preset-sync-engine.ts";
import type { StoredPreset } from "../state/preset-store.ts";

const USER = "user-1";
const preset = (name: string, gain = 2): EqPreset => ({ schema: 1, name, preamp: -3, bands: [{ type: "PK", freq: 1000, q: 1, gain }] });

/** In-memory stand-in for the sync API with the same revision rules. */
function fakeServer() {
  const rows = new Map<string, RemoteItem>();
  let rev = 0;
  const state = { quota: 200, purgedThroughRev: 0, beforeWrite: null as null | (() => void) };
  const api: ApiFetch = async <T>(path: string, req: ApiRequest = {}) => {
    const url = new URL(path, "http://x");
    const id = url.pathname.split("/")[2] ?? "";
    const body = req.body as { data?: unknown; baseRev: number } | undefined;
    if (req.method === undefined || req.method === "GET") {
      const since = Number(url.searchParams.get("sinceRev"));
      if (since > 0 && since < state.purgedThroughRev) throw new ApiError(410, { error: "resync_required" });
      const items = [...rows.values()].filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev);
      return { items, nextRev: items.at(-1)?.rev ?? since, hasMore: false } as T;
    }
    state.beforeWrite?.();
    const current = rows.get(id);
    if (req.method === "PUT") {
      if ((current?.rev ?? 0) !== body!.baseRev) {
        if (current) throw new ApiError(409, { error: "conflict", current });
        throw new ApiError(404, { error: "not_found" });
      }
      if (!current && [...rows.values()].filter((r) => !r.deleted).length >= state.quota) throw new ApiError(422, { error: "quota_exceeded" });
      const row = { id, rev: ++rev, updatedAt: 0, deleted: false, data: body!.data };
      rows.set(id, row);
      return row as T;
    }
    if (!current || current.deleted) throw new ApiError(404, { error: "not_found" });
    if (current.rev !== body!.baseRev) throw new ApiError(409, { error: "conflict", current });
    const row = { id, rev: ++rev, updatedAt: 0, deleted: true, data: null };
    rows.set(id, row);
    return row as T;
  };
  return { api, rows, state };
}

/** A browser's local preset cache. */
function device(): SyncTarget & { list: StoredPreset[]; lastRev: number } {
  const d = {
    list: [] as StoredPreset[],
    lastRev: 0,
    all: () => d.list,
    put: (item: StoredPreset) => void (d.list = d.list.some((p) => p.id === item.id) ? d.list.map((p) => (p.id === item.id ? item : p)) : [...d.list, item]),
    drop: (id: string) => void (d.list = d.list.filter((p) => p.id !== id)),
  };
  return d;
}

const local = (id: string, name: string, owner: string | null = USER): StoredPreset => ({ id, preset: preset(name), updatedAt: 1, owner, rev: 0, dirty: owner !== null, deleted: false });
const sync = async (api: ApiFetch, d: ReturnType<typeof device>) => {
  const r = await syncOnce(api, "token", USER, d, d.lastRev);
  d.lastRev = r.lastRev;
  return r;
};

describe("preset sync engine", () => {
  it("pushes new presets and another browser pulls them", async () => {
    const { api } = fakeServer();
    const a = device();
    const b = device();
    a.put(local("p1", "Warm"));
    await sync(api, a);
    expect(a.list[0]).toMatchObject({ rev: 1, dirty: false });
    await sync(api, b);
    expect(b.list).toHaveLength(1);
    expect(b.list[0]).toMatchObject({ id: "p1", owner: USER, rev: 1, dirty: false, preset: { name: "Warm" } });
  });

  it("on a conflict the server copy wins and the local edit is kept as a (conflict) copy", async () => {
    const { api, rows } = fakeServer();
    const a = device();
    const b = device();
    a.put(local("p1", "Warm"));
    await sync(api, a);
    await sync(api, b);
    b.put({ ...b.list[0]!, preset: preset("Warm", 5), dirty: true, updatedAt: 2 });
    await sync(api, b);
    a.put({ ...a.list[0]!, preset: preset("Warm", -4), dirty: true, updatedAt: 2 });
    const result = await sync(api, a);
    expect(result.conflicts).toEqual(["Warm"]);
    expect(a.list.find((p) => p.id === "p1")!.preset.bands[0]!.gain).toBe(5);
    const copy = a.list.find((p) => p.id !== "p1")!;
    expect(copy).toMatchObject({ preset: { name: "Warm (conflict)" }, dirty: false });
    expect((rows.get(copy.id)!.data as EqPreset).bands[0]!.gain).toBe(-4);
  });

  it("deletes propagate as tombstones", async () => {
    const { api } = fakeServer();
    const a = device();
    const b = device();
    a.put(local("p1", "Gone"));
    await sync(api, a);
    await sync(api, b);
    a.put({ ...a.list[0]!, deleted: true, dirty: true });
    await sync(api, a);
    expect(a.list).toHaveLength(0);
    await sync(api, b);
    expect(b.list).toHaveLength(0);
  });

  it("a client older than the tombstone cleanup resyncs fully and drops what the server lost", async () => {
    const { api, rows, state } = fakeServer();
    const b = device();
    const a = device();
    a.put(local("keep", "Keep"));
    a.put(local("lost", "Lost"));
    await sync(api, a);
    await sync(api, b);
    b.lastRev = 1;
    rows.delete("lost"); // tombstone already cleaned up
    state.purgedThroughRev = 5;
    await sync(api, b);
    expect(b.list.map((p) => p.id)).toEqual(["keep"]);
  });

  it("quota errors are shown on the preset and it stays queued", async () => {
    const { api, state } = fakeServer();
    state.quota = 0;
    const a = device();
    a.put(local("p1", "Big"));
    await sync(api, a);
    expect(a.list[0]).toMatchObject({ dirty: true, syncError: "Account preset limit reached" });
  });

  it("an edit made while the upload is in flight stays queued", async () => {
    const { api, state } = fakeServer();
    const a = device();
    a.put(local("p1", "Moving"));
    state.beforeWrite = () => {
      state.beforeWrite = null;
      a.put({ ...a.list[0]!, preset: preset("Moving", 7), updatedAt: 99 });
    };
    await sync(api, a);
    expect(a.list[0]).toMatchObject({ rev: 1, dirty: true });
    await sync(api, a);
    expect(a.list[0]).toMatchObject({ rev: 2, dirty: false });
  });

  it("offline and auth errors stop the round without losing local changes", async () => {
    const a = device();
    a.put(local("p1", "Offline"));
    const offline: ApiFetch = async () => {
      throw new ApiError(0, { error: "offline" });
    };
    await expect(syncOnce(offline, "t", USER, a, 0)).rejects.toMatchObject({ status: 0 });
    expect(a.list[0]).toMatchObject({ dirty: true, rev: 0 });
  });
});

describe("adopting local presets", () => {
  it("hands local-only presets to the account and skips duplicates it already has", () => {
    const d = device();
    d.put({ ...local("synced", "Warm"), rev: 3, dirty: false });
    d.put(local("dup", "warm ", null));
    d.put(local("new", "Bright", null));
    expect(adoptLocalPresets(d, USER)).toBe(1);
    expect(d.list.map((p) => [p.id, p.owner, p.dirty])).toEqual([
      ["synced", USER, false],
      ["new", USER, true],
    ]);
  });
});

describe("review regressions", () => {
  it("an edit made while the upload fails on quota is kept", async () => {
    const { api, state } = fakeServer();
    state.quota = 0;
    const a = device();
    a.put(local("p1", "Before"));
    state.beforeWrite = () => {
      state.beforeWrite = null;
      a.put({ ...a.list[0]!, preset: preset("Renamed"), updatedAt: 5 });
    };
    await sync(api, a);
    expect(a.list[0]).toMatchObject({ preset: { name: "Renamed" }, syncError: "Account preset limit reached", dirty: true });
  });

  it("a delete made while the first upload is in flight also deletes the server copy", async () => {
    const { api, state, rows } = fakeServer();
    const a = device();
    a.put(local("p1", "Short-lived"));
    state.beforeWrite = () => {
      state.beforeWrite = null;
      a.put({ ...a.list[0]!, deleted: true, dirty: true, updatedAt: 9 });
    };
    await sync(api, a);
    expect(a.list[0]).toMatchObject({ deleted: true, dirty: true, rev: 1 });
    await sync(api, a);
    expect(a.list).toHaveLength(0);
    expect(rows.get("p1")?.deleted).toBe(true);
  });

  it("a lost upload response does not produce a false (conflict) copy", async () => {
    const { api } = fakeServer();
    const a = device();
    a.put(local("p1", "Same"));
    // The server stored it, but the client never saw the reply.
    await api("/presets/p1", { method: "PUT", body: { data: a.list[0]!.preset, baseRev: 0 } });
    const result = await sync(api, a);
    expect(result.conflicts).toEqual([]);
    expect(a.list).toHaveLength(1);
    expect(a.list[0]).toMatchObject({ rev: 1, dirty: false });
  });

  it("repeated conflicts do not stack the suffix", async () => {
    const { api } = fakeServer();
    const a = device();
    const b = device();
    a.put(local("p1", "Warm (conflict)"));
    await sync(api, a);
    await sync(api, b);
    b.put({ ...b.list[0]!, preset: preset("Warm (conflict)", 6), dirty: true, updatedAt: 2 });
    await sync(api, b);
    a.put({ ...a.list[0]!, preset: preset("Warm (conflict)", -6), dirty: true, updatedAt: 2 });
    await sync(api, a);
    expect(a.list.map((p) => p.preset.name).sort()).toEqual(["Warm (conflict)", "Warm (conflict)"]);
  });
});

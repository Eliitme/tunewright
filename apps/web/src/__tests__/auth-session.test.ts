import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ApiFetch } from "../sync/api-client.ts";
import { createAuthStore, presetSyncTarget } from "../sync/auth-session.ts";
import { createPresetStore, localPresetRepository, visiblePresets, type PresetRepository, type StoredPreset } from "../state/preset-store.ts";

// Node 26 exposes its own (unconfigured) localStorage global, which shadows jsdom's; use a stub.
const items = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => items.get(k) ?? null,
  setItem: (k: string, v: string) => void items.set(k, v),
  removeItem: (k: string) => void items.delete(k),
});

const memoryRepo = (): PresetRepository => {
  let saved: StoredPreset[] = [];
  return { load: () => saved, persist: (p) => ((saved = p), true) };
};
const preset = { schema: 1 as const, name: "Mine", preamp: 0, bands: [] };
const user = { id: "u1", email: "me@example.com" };

/** Answers sign-in with a session and sync pulls with nothing. */
function fakeApi(onPresets?: () => never): ApiFetch {
  return async <T>(path: string) => {
    if (path === "/auth/verify") return { sessionToken: "s".repeat(43), user } as T;
    if (path.startsWith("/presets")) {
      onPresets?.();
      return { items: [], nextRev: 0, hasMore: false } as T;
    }
    return { ok: true } as T;
  };
}

describe("auth session", () => {
  beforeEach(() => items.clear());

  it("signing in sets the account and offers this browser's local presets", async () => {
    const presets = createPresetStore(memoryRepo());
    presets.getState().add(preset);
    const auth = createAuthStore(fakeApi(), presets);
    await auth.getState().verifyCode("me@example.com", "123456");
    expect(auth.getState().session?.user.email).toBe("me@example.com");
    expect(presets.getState().account).toBe("u1");
    expect(auth.getState().adoptableCount).toBe(1);
    auth.getState().adoptLocal(true);
    expect(presets.getState().presets[0]).toMatchObject({ owner: "u1", dirty: true });
  });

  it("signing out removes the account's presets from this browser but keeps local-only ones", async () => {
    const presets = createPresetStore(memoryRepo());
    presets.getState().add(preset);
    const auth = createAuthStore(fakeApi(), presets);
    await auth.getState().verifyCode("me@example.com", "123456");
    presets.getState().add({ ...preset, name: "Synced" });
    await auth.getState().logout();
    expect(auth.getState().session).toBeNull();
    expect(visiblePresets(presets.getState()).map((p) => p.preset.name)).toEqual(["Mine"]);
  });

  it("a rejected session signs out with a notice", async () => {
    const presets = createPresetStore(memoryRepo());
    const auth = createAuthStore(
      fakeApi(() => {
        throw new ApiError(401, { error: "unauthorized" });
      }),
      presets,
    );
    await auth.getState().verifyCode("me@example.com", "123456");
    expect(auth.getState().session).toBeNull();
    expect(auth.getState().notice).toMatch(/session ended/);
  });

  it("old stored presets load as local-only", () => {
    items.set("tunewright.presets.v1", JSON.stringify([{ id: "a", preset, updatedAt: 5 }]));
    expect(localPresetRepository.load()[0]).toMatchObject({ owner: null, rev: 0, dirty: false, deleted: false });
  });
});

describe("auth session review regressions", () => {
  beforeEach(() => items.clear());

  it("an ended session keeps unsynced edits hidden until the same account signs in again", async () => {
    const presets = createPresetStore(memoryRepo());
    let reject = false;
    const api: ApiFetch = async <T>(path: string) => {
      if (path === "/auth/verify") return { sessionToken: "s".repeat(43), user } as T;
      if (path.startsWith("/presets") && reject) throw new ApiError(401, { error: "unauthorized" });
      if (path.startsWith("/presets?")) return { items: [], nextRev: 0, hasMore: false } as T;
      throw new ApiError(0, { error: "offline" }); // pushes fail: the edit stays unsynced
    };
    const auth = createAuthStore(api, presets);
    await auth.getState().verifyCode("me@example.com", "123456");
    presets.getState().add({ ...preset, name: "Offline edit" });
    reject = true;
    await auth.getState().syncNow();
    expect(auth.getState().session).toBeNull();
    expect(visiblePresets(presets.getState())).toHaveLength(0);
    expect(presets.getState().presets[0]).toMatchObject({ owner: "u1", dirty: true });
    reject = false;
    await auth.getState().verifyCode("me@example.com", "123456");
    expect(visiblePresets(presets.getState()).map((p) => p.preset.name)).toEqual(["Offline edit"]);
  });

  it("the sync target ignores writes for an account that is no longer signed in", () => {
    const presets = createPresetStore(memoryRepo());
    const target = presetSyncTarget(presets);
    presets.getState().setAccount("u2");
    target.put({ id: "x", preset, updatedAt: 0, owner: "u1", rev: 3, dirty: false, deleted: false });
    expect(presets.getState().presets).toHaveLength(0);
  });

  it("offers to add local presets only after the first sync, and the offer survives a reload", async () => {
    const presets = createPresetStore(memoryRepo());
    presets.getState().add(preset);
    const auth = createAuthStore(fakeApi(), presets);
    await auth.getState().verifyCode("me@example.com", "123456");
    expect(auth.getState().adoptableCount).toBe(1);
    // A fresh store (page reload after the magic link) still shows the offer after its first sync.
    const reloaded = createAuthStore(fakeApi(), presets);
    expect(reloaded.getState().adoptableCount).toBe(0);
    await reloaded.getState().syncNow();
    expect(reloaded.getState().adoptableCount).toBe(1);
  });
});

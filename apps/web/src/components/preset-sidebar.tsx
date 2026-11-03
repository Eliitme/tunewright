import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { presetToDeviceState, TP35_PRO_PROFILE, type EqPreset } from "@tunewright/walkplay-protocol";
import { downloadJsonFile } from "../lib/download-json-file.ts";
import { useDeviceStore } from "../state/device-store.ts";
import { stateToPreset, usePresetStore, visiblePresets, type StoredPreset } from "../state/preset-store.ts";
import { apiFetch } from "../sync/api-client.ts";
import { describeApiError, useAuthStore } from "../sync/auth-session.ts";
import { GlassInput } from "./glassyui/glass-input.tsx";
import { PresetImportDialog } from "./preset-import-dialog.tsx";
import { Button, Panel } from "./ui-primitives.tsx";

export function PresetSidebar() {
  const device = useDeviceStore(
    useShallow((s) => ({
      ready: s.status === "ready" && s.confirmed && !!s.eq,
      busy: s.busy,
      eq: s.eq,
      filterMode: s.filterMode,
      applyState: s.applyState,
      setMessage: s.setMessage,
    })),
  );
  const store = usePresetStore();
  const presets = visiblePresets(store);
  const token = useAuthStore((s) => s.session?.token ?? null);
  const [importing, setImporting] = useState(false);
  // A share link (or anything else) can hand a preset to the import dialog for review.
  useEffect(() => {
    if (store.pendingImport) setImporting(true);
  }, [store.pendingImport]);

  /** Freezes the synced preset as a public snapshot and copies its link. */
  const share = async (p: StoredPreset) => {
    try {
      const { slug } = await apiFetch<{ slug: string }>(`/presets/${p.id}/share`, { method: "POST", token });
      const url = `${location.origin}/s/${slug}`;
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      device.setMessage(`Link copied: ${url} — it shows this preset as it is now; share again after editing.`);
    } catch (error) {
      device.setMessage(`Could not share: ${describeApiError(error)}`);
    }
  };
  const [name, setName] = useState("");

  /** Applies a stored preset; the active marker only moves when the DAC accepted it. */
  const apply = async (id: string, preset: EqPreset) => {
    try {
      const ok = await device.applyState(presetToDeviceState(preset, TP35_PRO_PROFILE), preset.filterMode);
      if (ok) store.setActive(id);
    } catch (error) {
      device.setMessage((error as Error).message);
    }
  };

  const saveCurrent = () => {
    if (!device.eq) return;
    try {
      const item = store.add(stateToPreset(name || `Preset ${presets.length + 1}`, device.eq, device.filterMode));
      store.setActive(item.id);
      setName("");
    } catch (error) {
      device.setMessage((error as Error).message);
    }
  };

  return (
    <Panel title="Presets" className="flex-1" actions={<Button variant="ghost" onClick={() => setImporting(true)}>Import</Button>}>
      {store.storageFailed && <p className="mb-2 text-sm text-warn">Browser storage is unavailable; presets will not persist.</p>}
      <ul className="mb-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {presets.length === 0 && (
          <li className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs leading-relaxed text-muted">
            No presets yet.
            <br />
            Name the current EQ below and press Save, or import an AutoEQ file.
          </li>
        )}
        {presets.map((p) => (
          <li
            key={p.id}
            className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 transition hover:bg-surface-2 ${store.activeId === p.id ? "bg-accent-soft ring-1 ring-accent/40" : ""}`}
          >
            <span className={`size-1.5 shrink-0 rounded-full ${store.activeId === p.id ? "bg-accent" : "bg-transparent"}`} aria-hidden />
            <button
              type="button"
              aria-current={store.activeId === p.id || undefined}
              className="flex-1 truncate text-left text-sm disabled:opacity-50"
              disabled={!device.ready || device.busy}
              title="Apply to the DAC"
              onClick={() => void apply(p.id, p.preset)}
            >
              {p.preset.name}
              {p.syncError && <span className="block text-[11px] text-warn">{p.syncError}</span>}
            </button>
            {token && p.owner && p.rev > 0 && !p.dirty && (
              <button type="button" className="rounded px-1.5 text-xs text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-fg" title="Copy a public link to this preset" onClick={() => void share(p)}>
                Share
              </button>
            )}
            <button type="button" className="rounded px-1.5 text-xs text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-fg" title="Export JSON" onClick={() => downloadJsonFile(`${p.preset.name}.json`, p.preset)}>
              Export
            </button>
            <button type="button" className="rounded px-1.5 text-xs text-danger opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" title="Delete" onClick={() => store.remove(p.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <div className="flex shrink-0 gap-2">
        <GlassInput
          className="h-8 min-w-0 flex-1 text-sm"
          aria-label="Preset name"
          placeholder="Name for current EQ"
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && device.ready && saveCurrent()}
        />
        <Button disabled={!device.ready} onClick={saveCurrent}>Save</Button>
      </div>
      <PresetImportDialog
        open={importing}
        initialText={store.pendingImport}
        canApply={device.ready && !device.busy}
        onCancel={() => (setImporting(false), store.setPendingImport(null))}
        onImport={(draft, applyNow) => {
          setImporting(false);
          store.setPendingImport(null);
          const item = store.add(draft.preset);
          if (applyNow) void apply(item.id, item.preset);
        }}
      />
    </Panel>
  );
}

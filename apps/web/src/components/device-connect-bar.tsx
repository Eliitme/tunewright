import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { isDirty, useDeviceStore } from "../state/device-store.ts";
import { AccountMenu } from "./account/account-menu.tsx";
import { Button } from "./ui-primitives.tsx";

const STATUS_TEXT = { disconnected: "Not connected", connecting: "Connecting…", ready: "Connected", error: "Error" } as const;

export function DeviceConnectBar({ onConnect }: { onConnect(): void }) {
  const store = useDeviceStore(
    useShallow((s) => ({
      status: s.status,
      firmware: s.firmware,
      busy: s.busy,
      confirmed: s.confirmed,
      dirty: isDirty(s),
      save: s.save,
      revert: s.revert,
      disconnect: s.disconnect,
    })),
  );
  const { dirty } = store;
  const ready = store.status === "ready";
  const canSave = dirty && store.confirmed && !store.busy;
  const { save } = store;

  // ⌘S / Ctrl+S saves to the DAC instead of opening the browser's save dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "s" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      if (canSave) void save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSave, save]);
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-surface/60 px-4 py-2 backdrop-blur-xl">
      <h1 className="mr-2 text-base font-semibold">Tunewright</h1>
      <span className={`inline-flex items-center gap-1.5 text-sm ${ready ? "text-accent" : "text-muted"}`}>
        <span className={`size-2 rounded-full ${ready ? "bg-accent" : "bg-line"}`} aria-hidden />
        {ready ? `TP35 Pro · firmware ${store.firmware ?? "?"}` : STATUS_TEXT[store.status]}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {ready && store.busy && <span className="text-xs text-muted">Working…</span>}
        {ready && dirty && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-2.5 py-0.5 text-xs font-medium text-warn">
            <span className="size-1.5 rounded-full bg-warn" aria-hidden />
            Unsaved
          </span>
        )}
        {ready && (
          <>
            <Button variant="ghost" disabled={!canSave} onClick={() => void store.revert()} title="Go back to the EQ stored in the DAC">Revert</Button>
            <Button variant={dirty ? "primary" : "secondary"} disabled={!canSave} onClick={() => void save()} title="Write this EQ to the DAC's memory (⌘S)">
              Save to DAC
            </Button>
            <Button variant="ghost" disabled={store.busy} onClick={() => void store.disconnect()}>Disconnect</Button>
          </>
        )}
        {!ready && (
          <Button variant="primary" disabled={store.status === "connecting"} onClick={onConnect}>Connect TP35 Pro</Button>
        )}
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <AccountMenu />
      </div>
    </header>
  );
}

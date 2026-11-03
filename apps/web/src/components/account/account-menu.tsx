/** Header account control: sign in, sync status, sign out (here or everywhere). */
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "../../sync/auth-session.ts";
import { ConfirmDialog } from "../confirm-dialog.tsx";
import { Button } from "../ui-primitives.tsx";
import { SignInDialog } from "./sign-in-dialog.tsx";

const SYNC_TEXT = { idle: "Synced", syncing: "Syncing…", offline: "Offline", error: "Sync failed" } as const;

export function AccountMenu() {
  const a = useAuthStore(useShallow((s) => ({ session: s.session, syncStatus: s.syncStatus, adoptable: s.adoptableCount })));
  const { logout, adoptLocal, syncNow } = useAuthStore.getState();
  const [signingIn, setSigningIn] = useState(false);
  const [menu, setMenu] = useState(false);

  if (!a.session) {
    return (
      <>
        <Button variant="ghost" onClick={() => setSigningIn(true)} title="Sync presets between browsers and the Mac app">Sign in</Button>
        <SignInDialog open={signingIn} onClose={() => setSigningIn(false)} />
      </>
    );
  }
  const tone = a.syncStatus === "error" ? "text-danger" : a.syncStatus === "offline" ? "text-warn" : "text-muted";
  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-2 rounded-full px-2.5 py-1 text-sm hover:bg-surface-2"
        aria-expanded={menu}
        onClick={() => setMenu((v) => !v)}
      >
        <span className="max-w-40 truncate">{a.session.user.email}</span>
        <span className={`text-xs ${tone}`}>{SYNC_TEXT[a.syncStatus]}</span>
      </button>
      {menu && (
        <div className="absolute right-0 z-30 mt-1 flex w-48 flex-col rounded-xl border border-line bg-surface p-1 text-sm shadow-lg backdrop-blur-xl" onMouseLeave={() => setMenu(false)}>
          {[
            ["Sync now", () => void syncNow()],
            ["Sign out", () => void logout()],
            ["Sign out everywhere", () => void logout(true)],
          ].map(([label, action]) => (
            <button key={label as string} type="button" className="rounded-lg px-3 py-1.5 text-left hover:bg-surface-2" onClick={() => (setMenu(false), (action as () => void)())}>
              {label as string}
            </button>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={a.adoptable > 0}
        title="Add this browser's presets to your account?"
        confirmLabel={`Add ${a.adoptable} preset${a.adoptable === 1 ? "" : "s"}`}
        onConfirm={() => adoptLocal(true)}
        onCancel={() => adoptLocal(false)}
      >
        <p>
          {a.adoptable} preset{a.adoptable === 1 ? " was" : "s were"} made here before you signed in. Add {a.adoptable === 1 ? "it" : "them"} to {a.session.user.email} so{" "}
          {a.adoptable === 1 ? "it syncs" : "they sync"} to your other devices? Presets the account already has are skipped.
        </p>
        <p className="text-muted">If you choose Cancel they stay in this browser only.</p>
      </ConfirmDialog>
    </div>
  );
}

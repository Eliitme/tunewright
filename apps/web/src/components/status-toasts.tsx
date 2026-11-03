/** Floating status messages so banners never push the layout around. */
import { useShallow } from "zustand/react/shallow";
import { useDeviceStore } from "../state/device-store.ts";
import { useAuthStore } from "../sync/auth-session.ts";
import { Button } from "./ui-primitives.tsx";

const toast = "pointer-events-auto flex max-w-xl items-center gap-3 rounded-xl border px-3 py-2 text-sm shadow-lg backdrop-blur-xl";

export function StatusToasts() {
  const s = useDeviceStore(
    useShallow((st) => ({
      message: st.message,
      foreign: st.foreignActivity,
      unconfirmed: st.status === "ready" && !st.confirmed,
      setMessage: st.setMessage,
      reread: st.rereadDevice,
    })),
  );
  const auth = useAuthStore(useShallow((st) => ({ notice: st.notice, outdated: st.outdated, setNotice: st.setNotice })));
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2 px-4" role="status">
      {s.unconfirmed && (
        <div className={`${toast} border-warn bg-surface text-warn`}>
          The DAC returned an empty EQ that could not be confirmed; editing is locked.
          <Button onClick={() => void s.reread()}>Read again</Button>
        </div>
      )}
      {s.foreign && (
        <div className={`${toast} border-warn bg-surface text-warn`}>Another app or tab seems to be controlling the TP35 Pro.</div>
      )}
      {auth.outdated && (
        <div className={`${toast} border-warn bg-surface text-warn`}>
          A newer version of Tunewright is required for syncing.
          <Button onClick={() => location.reload()}>Reload</Button>
        </div>
      )}
      {auth.notice && (
        <div className={`${toast} border-line bg-surface`}>
          {auth.notice}
          <button type="button" className="text-muted" onClick={() => auth.setNotice(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
      {s.message && (
        <div className={`${toast} border-line bg-surface`}>
          {s.message}
          <button type="button" className="text-muted" onClick={() => s.setMessage(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
    </div>
  );
}

import { useEffect } from "react";
import { DeviceConnectBar } from "./components/device-connect-bar.tsx";
import { loadFakeTransportIfRequested } from "./dev/fake-transport-loader.ts";
import { isWebHidSupported, openTp35Transport, watchTp35Plugged } from "./hid/tp35-device-connection.ts";
import { AuthVerifyPage } from "./pages/auth-verify-page.tsx";
import { EditorPage } from "./pages/editor-page.tsx";
import { UnsupportedBrowserPage } from "./pages/unsupported-browser-page.tsx";
import { isDirty, useDeviceStore } from "./state/device-store.ts";
import { openSharedLink } from "./sync/shared-link-opener.ts";
import { startSyncTriggers } from "./sync/sync-triggers.ts";

/** Only one connection attempt at a time: auto-connect, plug events and clicks can overlap. */
let connecting: Promise<void> | null = null;

function connect(mode: "prompt" | "auto"): Promise<void> {
  connecting ??= attemptConnect(mode).finally(() => (connecting = null));
  return connecting;
}

async function attemptConnect(mode: "prompt" | "auto") {
  const store = useDeviceStore.getState();
  if (store.status === "ready") return;
  try {
    const transport = (await loadFakeTransportIfRequested()) ?? (await openTp35Transport(mode));
    if (transport) await store.connectWith(transport);
  } catch (error) {
    // The user closing the chooser is not an error worth showing.
    if ((error as Error).name !== "NotFoundError") useDeviceStore.setState({ message: (error as Error).message });
  }
}

export function App() {
  if (location.pathname === "/auth/verify") return <AuthVerifyPage />;
  return <EditorApp />;
}

function EditorApp() {
  const supported = isWebHidSupported() || (import.meta.env.DEV && new URLSearchParams(location.search).has("fake"));
  useEffect(() => {
    if (!supported) return;
    void connect("auto");
    return watchTp35Plugged(() => void connect("auto"));
  }, [supported]);
  useEffect(() => startSyncTriggers(), []);
  useEffect(() => void openSharedLink(location.pathname, (m) => useDeviceStore.getState().setMessage(m)), []);
  // Edits live only in DAC RAM until saved; warn before the page goes away.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty(useDeviceStore.getState())) e.preventDefault();
    };
    addEventListener("beforeunload", onBeforeUnload);
    return () => removeEventListener("beforeunload", onBeforeUnload);
  }, []);
  if (!supported) return <UnsupportedBrowserPage />;
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <DeviceConnectBar onConnect={() => void connect("prompt")} />
      <EditorPage />
    </div>
  );
}

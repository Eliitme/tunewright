/** Wires the spike page buttons to the probes and keeps a results log. */
import { TP35_PRO_PROFILE, WalkplaySession, type DeviceEqState } from "@tunewright/walkplay-protocol";
import { describeCollections, findControlCollection, WebHidTransport } from "@tunewright/webhid-transport";
import * as probe from "./spike-probes.ts";

const log = document.querySelector<HTMLPreElement>("#log")!;
const status = document.querySelector<HTMLSpanElement>("#status")!;
const notes = document.querySelector<HTMLInputElement>("#notes")!;
const results: { at: string; probe: string; result: unknown }[] = [];
let device: HIDDevice | null = null;
let transport: WebHidTransport | null = null;
let session: WalkplaySession | null = null;
/** Taken once from the first confirmed read so a probe band can never end up in it. */
let snapshot: DeviceEqState | null = null;
let busy = false;

function record(name: string, result: unknown) {
  results.push({ at: new Date().toISOString(), probe: name, result });
  log.textContent = `▶ ${name}\n${JSON.stringify(result, null, 2)}\n\n` + log.textContent;
}

/** One probe at a time: every device button is disabled while anything runs. */
function refreshButtons() {
  document.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((b) => {
    const action = b.dataset.action ?? "";
    b.disabled = action === "download" ? false : busy || (action !== "connect" && !session);
  });
}

async function disconnectCurrent() {
  session?.dispose();
  await transport?.close();
  session = null;
  transport = null;
  device = null;
}

async function connect() {
  const [picked] = await navigator.hid.requestDevice({
    filters: [{ vendorId: TP35_PRO_PROFILE.vendorId, productId: TP35_PRO_PROFILE.productId }],
  });
  if (!picked) return;
  await disconnectCurrent();
  if (!picked.opened) await picked.open();
  record("collections", describeCollections(picked));
  const control = findControlCollection(picked, TP35_PRO_PROFILE.reportId);
  if (!control) {
    status.textContent = "Connected, but no collection has output report 0x4B (see collections)";
    return;
  }
  const length = control.outputReports.find((r) => r.id === TP35_PRO_PROFILE.reportId)?.bytes ?? 63;
  device = picked;
  transport = new WebHidTransport(picked, length);
  transport.onDisconnect(() => {
    status.textContent = "Disconnected";
    void disconnectCurrent().then(refreshButtons);
  });
  session = new WalkplaySession(transport, TP35_PRO_PROFILE, { enableProbeAccess: true });
  status.textContent = `${picked.productName} · output report ${length} bytes`;
}

function requireSnapshot(): DeviceEqState {
  if (!snapshot) throw new Error('Run "Read EQ" first; writes are blocked until a snapshot exists');
  return snapshot;
}

const withProbeBand = (base: DeviceEqState) => ({
  ...base,
  bands: base.bands.map((b, i) => (i === probe.PROBE_BAND ? { type: "PK" as const, freq: 1000, q: 1, gain: 6 } : b)),
});

const actions: Record<string, (s: WalkplaySession) => Promise<unknown>> = {
  describe: async () => describeCollections(device!),
  version: async (s) => ({ firmware: await s.readVersion() }),
  state: async (s) => {
    const r = await probe.probeReadState(s);
    const taken = !snapshot && r.confirmed;
    if (taken) snapshot = r.state;
    return { ...r, snapshot: taken ? "taken" : snapshot ? "kept from first read" : "not taken (read unconfirmed)" };
  },
  coefficients: (s) => probe.probeStoredCoefficients(s),
  nonce: (s) => probe.probeNonceEcho(s),
  registers: (s) => probe.probeRawRegisters(s),
  peak: (s) => probe.probeAudiblePeak(s, requireSnapshot()),
  coefUsed: (s) => (requireSnapshot(), probe.probeCoefficientsUsed(s)),
  hsCut: (s) => (requireSnapshot(), probe.probeHighShelfCut(s)),
  hsBoost: (s) => (requireSnapshot(), probe.probeHighShelfBoostMetadata(s)),
  type4: (s) => (requireSnapshot(), probe.probeFilterTypeByte(s, 4, "LP")),
  type5: (s) => (requireSnapshot(), probe.probeFilterTypeByte(s, 5, "HP")),
  restore: async (s) => (await s.applyVerified(requireSnapshot()), { restored: true }),
  save: async (s) => {
    const test = withProbeBand(requireSnapshot());
    await s.save(test);
    return { saved: test.bands[probe.PROBE_BAND], next: "Unplug, replug, Connect, Read EQ, then Save snapshot back" };
  },
  saveSnapshot: async (s) => (await s.save(requireSnapshot()), { saved: "snapshot" }),
};

function download() {
  const body = { device: device?.productName, userAgent: navigator.userAgent, notes: notes.value, snapshot, results };
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "tp35-hardware-spike-results.json" });
  a.click();
  URL.revokeObjectURL(a.href);
}

document.addEventListener("click", async (e) => {
  const action = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "download") return download();
  if (busy) return;
  busy = true;
  refreshButtons();
  try {
    if (action === "connect") await connect();
    else if (session) record(action, await actions[action]!(session));
  } catch (error) {
    record(action, { error: (error as Error).name, message: (error as Error).message });
  } finally {
    busy = false;
    refreshButtons();
  }
});

if (!("hid" in navigator)) status.textContent = "This browser has no WebHID. Use Chrome or Edge.";
refreshButtons();

export function UnsupportedBrowserPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="mb-3 text-2xl font-semibold">This browser can't talk to the DAC</h1>
      <p className="mb-2 text-muted">
        Tunewright uses WebHID, which is available in Chrome, Edge and Opera on desktop. Safari and Firefox do not support it.
      </p>
      <p className="text-muted">Open this page in Chrome or Edge, or use the macOS app.</p>
    </main>
  );
}

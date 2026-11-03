/**
 * Opens `/s/<slug>`: fetches the public snapshot and hands it to the import
 * dialog, which validates it, lowers the preamp if needed and previews it
 * before anything is saved or sent to the DAC.
 */
import { usePresetStore } from "../state/preset-store.ts";
import { apiFetch, type ApiFetch } from "./api-client.ts";
import { describeApiError } from "./auth-session.ts";

export const sharedSlugFromPath = (path: string) => /^\/s\/([A-Za-z0-9]{12,32})\/?$/.exec(path)?.[1] ?? null;

export async function openSharedLink(path: string, report: (message: string) => void, api: ApiFetch = apiFetch): Promise<void> {
  const slug = sharedSlugFromPath(path);
  if (!slug) return;
  history.replaceState(null, "", "/");
  try {
    const snapshot = await api<unknown>(`/s/${slug}`);
    usePresetStore.getState().setPendingImport(JSON.stringify(snapshot));
  } catch (error) {
    report(error instanceof Error && error.message === "not_found" ? "This share link no longer exists." : `Could not open the share link: ${describeApiError(error)}`);
  }
}

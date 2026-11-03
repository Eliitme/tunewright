/** JSON calls to the sync API with the bearer session and client version header. */
import { appEnvironment, CLIENT_VERSION } from "../config/app-environment.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface ApiRequest {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
}

export type ApiFetch = <T>(path: string, request?: ApiRequest) => Promise<T>;

/** `fetchImpl` is injectable so the sync engine can be tested without a network. */
export function createApiFetch(baseUrl = appEnvironment.apiUrl, fetchImpl: typeof fetch = (...a) => fetch(...a)): ApiFetch {
  return async <T>(path: string, { method = "GET", body, token }: ApiRequest = {}) => {
    const headers: Record<string, string> = { "X-Client-Version": CLIENT_VERSION };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, { error: "offline" });
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ApiError(res.status, data);
    return data as T;
  };
}

export const apiFetch = createApiFetch();

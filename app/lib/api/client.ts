export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status = 0, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export function resolveApiUrl(value: string | null | undefined) {
  if (!value) return "";
  if (/^https?:\/\//iu.test(value)) return value;
  if (!apiBaseUrl) return value;
  return `${apiBaseUrl}${value.startsWith("/") ? value : `/${value}`}`;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!apiBaseUrl) throw new ApiRequestError("Java API base URL is not configured");

  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`${apiBaseUrl}/api/v1${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let code: string | undefined;
    let message = `API request failed with status ${response.status}`;
    try {
      const error = await response.json() as { code?: string; message?: string };
      code = error.code;
      message = error.message ?? message;
    } catch {
      // Keep the status-based message for non-JSON error responses.
    }
    throw new ApiRequestError(message, response.status, code);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

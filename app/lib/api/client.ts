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
let csrfToken: string | null = null;

async function getCsrfToken() {
  if (!apiBaseUrl) throw new ApiRequestError("Java API base URL is not configured");
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/csrf`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new ApiRequestError(`CSRF request failed with status ${response.status}`, response.status);
  const payload = await response.json() as { token?: string };
  if (!payload.token) throw new ApiRequestError("CSRF token is missing");
  csrfToken = payload.token;
  return csrfToken;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!apiBaseUrl) throw new ApiRequestError("Java API base URL is not configured");

  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("X-XSRF-TOKEN", csrfToken ?? await getCsrfToken());
  }

  const response = await fetch(`${apiBaseUrl}/api/v1${path}`, {
    ...init,
    method,
    headers,
    credentials: "include",
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
    if (response.status === 403 && code === "CSRF_INVALID") {
      csrfToken = null;
    }
    throw new ApiRequestError(message, response.status, code);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

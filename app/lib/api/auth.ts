import { ApiRequestError, apiBaseUrl } from "./client";

export type AuthUser = {
  id: number;
  username: string;
  role: "USER" | "ADMIN" | string;
  avatarUrl: string | null;
};

type AuthUserResponse = { user: AuthUser };
type CsrfResponse = { token: string };

const csrfCookieName = "XSRF-TOKEN";
const csrfHeaderName = "X-XSRF-TOKEN";

function readCookie(name: string) {
  if (typeof document === "undefined") return "";
  const prefix = `${encodeURIComponent(name)}=`;
  const cookie = document.cookie.split("; ").find((value) => value.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : "";
}

export function readCsrfToken() {
  return readCookie(csrfCookieName);
}

async function parseError(response: Response, fallback: string) {
  let code: string | undefined;
  let message = fallback;
  try {
    const error = await response.json() as { code?: string; message?: string };
    code = error.code;
    message = error.message ?? message;
  } catch {
    // Keep the status-based message for non-JSON responses.
  }
  return new ApiRequestError(message, response.status, code);
}

export async function getCsrfToken() {
  if (!apiBaseUrl) throw new ApiRequestError("API base URL is not configured");
  const response = await fetch(`${apiBaseUrl}/api/v1/auth/csrf`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw await parseError(response, `CSRF request failed with status ${response.status}`);
  const payload = await response.json() as CsrfResponse;
  return payload.token;
}

export async function authenticatedRequest<T>(path: string, init: RequestInit = {}) {
  if (!apiBaseUrl) throw new ApiRequestError("API base URL is not configured");
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const method = (init.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfToken = await getCsrfToken();
    headers.set(csrfHeaderName, csrfToken || readCsrfToken());
  }

  const response = await fetch(`${apiBaseUrl}/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!response.ok) throw await parseError(response, `Auth request failed with status ${response.status}`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function getCurrentUser() {
  return authenticatedRequest<AuthUserResponse>("/auth/me");
}

export function login(username: string, password: string) {
  return authenticatedRequest<AuthUserResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function register(username: string, password: string) {
  return authenticatedRequest<AuthUserResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout() {
  return authenticatedRequest<void>("/auth/logout", { method: "POST" });
}

export function uploadAvatar(file: File) {
  const body = new FormData();
  body.append("avatar", file);
  return authenticatedRequest<AuthUserResponse>("/auth/me/avatar", {
    method: "PUT",
    body,
  });
}

export function deleteAvatar() {
  return authenticatedRequest<AuthUserResponse>("/auth/me/avatar", { method: "DELETE" });
}

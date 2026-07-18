import { readCsrfToken, type AuthUser } from "./auth";
import { ApiRequestError, apiBaseUrl } from "./client";
import type { ArticleDetail, ArticlePageResponse, ArticleSummary } from "./articles";

export type EditorArticle = ArticleSummary;
export type EditorArticleDetail = ArticleDetail;

export type EditorArticleInput = {
  title: string;
  slug: string;
  summary: string;
  tags: string;
  status: ArticleSummary["status"];
  publishedAt: string;
  contentMarkdown: string;
  cover?: File | null;
  assets?: File[];
};

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function getDefaultEditorApiBase() {
  if (!apiBaseUrl) return "http://localhost:8090";
  try {
    const url = new URL(apiBaseUrl);
    if (isLocalHost(url.hostname)) {
      url.port = "8090";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return "http://localhost:8090";
  }
}

function getEditorApiBase() {
  const configured = process.env.NEXT_PUBLIC_EDITOR_API_BASE_URL;
  if (!configured) return getDefaultEditorApiBase();

  try {
    const editorUrl = new URL(configured);
    if (apiBaseUrl) {
      const mainUrl = new URL(apiBaseUrl);
      // localhost and 127.0.0.1 are different cookie hosts. Keep the editor
      // service on the same local hostname as the main API so its session is
      // available when the editor is opened from the browser.
      if (isLocalHost(mainUrl.hostname) && isLocalHost(editorUrl.hostname)) {
        editorUrl.hostname = mainUrl.hostname;
      }
    }
    return editorUrl.toString().replace(/\/$/, "");
  } catch {
    return configured.replace(/\/$/, "");
  }
}

const editorApiBase = getEditorApiBase();

type EditorAuthUserResponse = { user: AuthUser };

async function getEditorCsrfToken() {
  const response = await fetch(`${editorApiBase}/api/v1/auth/csrf`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new ApiRequestError(`Editor CSRF request failed with status ${response.status}`, response.status);
  }
  const payload = await response.json() as { token: string };
  return payload.token;
}

export async function editorRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!editorApiBase) throw new ApiRequestError("Editor API base URL is not configured");
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrfToken = await getEditorCsrfToken();
    headers.set("X-XSRF-TOKEN", csrfToken || readCsrfToken());
  }
  const response = await fetch(editorApiBase + "/api/v1" + path, {
    ...init,
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    let message = `Editor API request failed with status ${response.status}`;
    let code: string | undefined;
    try {
      const error = await response.json() as { message?: string; code?: string };
      message = error.message ?? message;
      code = error.code;
    } catch {
      // Keep the status-based message for non-JSON responses.
    }
    throw new ApiRequestError(message, response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function getEditorCurrentUser() {
  return editorRequest<EditorAuthUserResponse>("/auth/me");
}

export function getEditorArticles(page = 0, size = 100) {
  return editorRequest<ArticlePageResponse>(`/editor/articles?page=${page}&size=${size}`);
}

export function getEditorArticle(slug: string) {
  return editorRequest<EditorArticleDetail>(`/editor/articles/${encodeURIComponent(slug)}`);
}

export function saveEditorArticle(input: EditorArticleInput, existingSlug?: string) {
  const form = new FormData();
  form.set("title", input.title);
  form.set(existingSlug ? "newSlug" : "slug", input.slug);
  form.set("summary", input.summary);
  form.set("tags", input.tags);
  form.set("status", input.status);
  form.set("publishedAt", input.publishedAt);
  form.set("contentMarkdown", input.contentMarkdown);
  if (input.cover) form.set("cover", input.cover, input.cover.name);
  for (const asset of input.assets ?? []) form.append("assets", asset, asset.name);
  const path = existingSlug ? `/editor/articles/${encodeURIComponent(existingSlug)}` : "/editor/articles";
  return editorRequest<EditorArticleDetail>(path, { method: existingSlug ? "PUT" : "POST", body: form });
}

export function deleteEditorArticle(slug: string) {
  return editorRequest<void>(`/editor/articles/${encodeURIComponent(slug)}`, { method: "DELETE" });
}

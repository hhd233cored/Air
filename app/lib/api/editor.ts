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

// The editor is served by the same FastAPI process as the public API. Keeping
// one origin also makes the Session and CSRF cookies available to the editor.
const editorApiBase = (apiBaseUrl || "http://localhost:8080").replace(/\/$/, "");

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

import { ApiRequestError } from "./client";
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

const editorApiBase = (process.env.NEXT_PUBLIC_EDITOR_API_BASE_URL ?? "http://127.0.0.1:8090").replace(/\/$/, "");

export async function editorRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!editorApiBase) throw new ApiRequestError("编辑器 API 地址未配置");
  const response = await fetch(editorApiBase + "/api/v1" + path, {
    ...init,
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
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

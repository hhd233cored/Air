import type { ChatterDetail, ChatterPageResponse, ChatterSummary } from "./chatter";
import { editorRequest } from "./editor";

export type EditorChatterInput = {
  slug: string;
  status: string;
  publishedAt: string;
  contentMarkdown: string;
};

export function getEditorChatter(page = 0, size = 100) {
  return editorRequest<ChatterPageResponse>(`/editor/chatter?page=${page}&size=${size}`);
}

export function getEditorChatterEntry(slug: string) {
  return editorRequest<ChatterDetail>(`/editor/chatter/${encodeURIComponent(slug)}`);
}

export function saveEditorChatter(input: EditorChatterInput, existingSlug?: string) {
  const form = new FormData();
  form.set(existingSlug ? "newSlug" : "slug", input.slug);
  form.set("status", input.status);
  form.set("publishedAt", input.publishedAt);
  form.set("contentMarkdown", input.contentMarkdown);
  const path = existingSlug ? `/editor/chatter/${encodeURIComponent(existingSlug)}` : "/editor/chatter";
  return editorRequest<ChatterDetail>(path, { method: existingSlug ? "PUT" : "POST", body: form });
}

export function deleteEditorChatter(slug: string) {
  return editorRequest<void>(`/editor/chatter/${encodeURIComponent(slug)}`, { method: "DELETE" });
}

export type { ChatterSummary };

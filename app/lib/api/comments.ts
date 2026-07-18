import { apiGet } from "./client";
import { authenticatedRequest } from "./auth";

export type CommentTargetType = "ARTICLE" | "CHATTER" | "GUESTBOOK";

export type CommentAuthor = {
  id: number;
  username: string;
  avatarUrl: string | null;
};

export type CommentItem = {
  id: number;
  targetType: CommentTargetType;
  targetId: string;
  parentId: number | null;
  content: string;
  status: "VISIBLE" | "HIDDEN" | "DELETED" | string;
  author: CommentAuthor;
  createdAt: string;
  updatedAt: string;
};

export type CommentPage = {
  content: CommentItem[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

const pending = new Map<string, Promise<CommentPage>>();
const cache = new Map<string, CommentPage>();

function cacheKey(targetType: CommentTargetType, slug: string, page: number, size: number) {
  return `${targetType}:${slug}:${page}:${size}`;
}

function resourceFor(targetType: CommentTargetType, slug: string) {
  if (targetType === "ARTICLE") return `articles/${encodeURIComponent(slug)}/comments`;
  if (targetType === "CHATTER") return `chatter/${encodeURIComponent(slug)}/comments`;
  return "guestbook/messages";
}

export function getComments(targetType: CommentTargetType, slug: string, page = 0, size = 20) {
  const key = cacheKey(targetType, slug, page, size);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = apiGet<CommentPage>(`/${resourceFor(targetType, slug)}?page=${page}&size=${size}`)
    .then((result) => {
      cache.set(key, result);
      return result;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export function invalidateComments(targetType: CommentTargetType, slug: string) {
  const prefix = `${targetType}:${slug}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function createComment(
  targetType: CommentTargetType,
  slug: string,
  content: string,
  parentId: number | null = null,
) {
  return authenticatedRequest<CommentItem>(`/${resourceFor(targetType, slug)}`, {
    method: "POST",
    body: JSON.stringify({ content, parentId }),
  }).then((comment) => {
    invalidateComments(targetType, slug);
    return comment;
  });
}

export function deleteComment(commentId: number, targetType: CommentTargetType = "ARTICLE") {
  const resource = targetType === "GUESTBOOK" ? `/guestbook/messages/${commentId}` : `/comments/${commentId}`;
  return authenticatedRequest<void>(resource, { method: "DELETE" });
}

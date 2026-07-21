import { apiGet, apiRequest } from "./client";

export type ArticleSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  coverUrl: string | null;
  coverColor?: string | null;
  tags: string[];
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ArticleDetail = ArticleSummary & {
  contentMarkdown: string;
};

export type ArticlePageResponse = {
  content: ArticleSummary[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export const usesDatabaseContent = process.env.NEXT_PUBLIC_CONTENT_STORAGE === "database";

type ArticleRequest = {
  signal: AbortSignal;
  promise: Promise<ArticleDetail>;
};

const articleDetailCache = new Map<string, ArticleDetail>();
const articleDetailRequests = new Map<string, ArticleRequest>();
const localArticleDetailCache = new Map<string, ArticleDetail>();
const localArticleDetailRequests = new Map<string, Promise<ArticleDetail>>();
const localIndexCache: { value: ArticleSummary[]; expiresAt: number } = { value: [], expiresAt: 0 };
let localIndexRequest: Promise<ArticleSummary[]> | null = null;

function normalizeSlug(slug: string) {
  return slug.trim().toLowerCase();
}

function createAbortError() {
  const error = new Error("The request was aborted");
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function getPublishedArticles(page = 0, size = 3, tag?: string, q?: string) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  if (tag) params.set("tag", tag);
  if (q) params.set("q", q);
  return apiGet<ArticlePageResponse>(`/articles?${params.toString()}`);
}

export function getPublishedArticle(slug: string, signal?: AbortSignal) {
  const key = normalizeSlug(slug);
  const cached = articleDetailCache.get(key);
  if (cached) return Promise.resolve(cached);
  if (signal?.aborted) return Promise.reject(createAbortError());

  const current = articleDetailRequests.get(key);
  if (current && !current.signal.aborted) return current.promise;
  if (current) articleDetailRequests.delete(key);

  const controller = new AbortController();
  const requestSignal = signal ?? controller.signal;
  const promise = apiRequest<ArticleDetail>(`/articles/${encodeURIComponent(slug)}`, { signal: requestSignal })
    .then((article) => {
      articleDetailCache.set(key, article);
      return article;
    })
    .finally(() => {
      const request = articleDetailRequests.get(key);
      if (request?.promise === promise) articleDetailRequests.delete(key);
    });

  articleDetailRequests.set(key, { signal: requestSignal, promise });
  return promise;
}

export async function getAllPublishedArticles(pageSize = 50, q?: string) {
  const articles: ArticleSummary[] = [];
  let page = 0;

  while (true) {
    const response = await getPublishedArticles(page, pageSize, undefined, q);
    articles.push(...response.content);
    if (page + 1 >= response.totalPages || response.content.length === 0) break;
    page += 1;
  }

  return articles;
}

export async function getLocalArticleIndex() {
  if (localIndexCache.expiresAt > Date.now()) return localIndexCache.value;
  if (localIndexRequest) return localIndexRequest;

  localIndexRequest = fetch("/articles/index.json", { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Local article index request failed with status ${response.status}`);
      const articles = await response.json() as ArticleSummary[];
      localIndexCache.value = articles;
      localIndexCache.expiresAt = Date.now() + 60_000;
      return articles;
    })
    .finally(() => {
      localIndexRequest = null;
    });

  return localIndexRequest;
}

export function getLocalArticleDetail(slug: string) {
  const key = normalizeSlug(slug);
  const cached = localArticleDetailCache.get(key);
  if (cached) return Promise.resolve(cached);
  const current = localArticleDetailRequests.get(key);
  if (current) return current;

  const request = Promise.all([
    getLocalArticleIndex(),
    fetch(`/articles/${encodeURIComponent(slug)}/article.md`, { headers: { Accept: "text/markdown" } }).then(async (response) => {
      if (!response.ok) throw new Error(`Local article request failed with status ${response.status}`);
      return response.text();
    }),
  ]).then(([articles, contentMarkdown]) => {
    const metadata = articles.find((article) => normalizeSlug(article.slug) === key);
    if (!metadata) throw new Error("Local article metadata not found");
    const detail = { ...metadata, contentMarkdown };
    localArticleDetailCache.set(key, detail);
    return detail;
  }).finally(() => {
    if (localArticleDetailRequests.get(key) === request) localArticleDetailRequests.delete(key);
  });

  localArticleDetailRequests.set(key, request);
  return request;
}

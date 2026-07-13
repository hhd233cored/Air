import { apiGet } from "./client";

export type ArticleSummary = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  coverUrl: string | null;
  tags: string[];
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishedAt: string | null;
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

export function getPublishedArticles(page = 0, size = 3, tag?: string) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  if (tag) params.set("tag", tag);
  return apiGet<ArticlePageResponse>(`/articles?${params.toString()}`);
}

export function getPublishedArticle(slug: string) {
  return apiGet<ArticleDetail>(`/articles/${encodeURIComponent(slug)}`);
}

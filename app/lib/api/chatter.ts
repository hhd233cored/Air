import { apiGet } from "./client";

export type ChatterSummary = {
  id: string | null;
  slug: string;
  preview: string;
  status: string;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ChatterDetail = ChatterSummary & {
  contentMarkdown: string;
};

export type ChatterPageResponse = {
  content: ChatterSummary[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

const localChatterCache: { value: ChatterSummary[]; expiresAt: number } = { value: [], expiresAt: 0 };
let localChatterRequest: Promise<ChatterSummary[]> | null = null;

export function getChatterEntries(page = 0, size = 50) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  return apiGet<ChatterPageResponse>(`/chatter?${params.toString()}`);
}

export function getChatterEntry(slug: string) {
  return apiGet<ChatterDetail>(`/chatter/${encodeURIComponent(slug)}`);
}

export function getLocalChatterEntry(slug: string) {
  return fetch(`/chatter/${encodeURIComponent(slug)}/chatter.md`, {
    headers: { Accept: "text/markdown" },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Local chatter detail request failed with status ${response.status}`);
    return response.text();
  });
}

export function getLocalChatterIndex() {
  if (localChatterCache.expiresAt > Date.now()) return Promise.resolve(localChatterCache.value);
  if (localChatterRequest) return localChatterRequest;

  localChatterRequest = fetch("/chatter/index.json", { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Local chatter index request failed with status ${response.status}`);
      const entries = await response.json() as ChatterSummary[];
      localChatterCache.value = entries;
      localChatterCache.expiresAt = Date.now() + 60_000;
      return entries;
    })
    .finally(() => {
      localChatterRequest = null;
    });

  return localChatterRequest;
}

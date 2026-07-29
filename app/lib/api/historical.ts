import { apiGet } from "./client";

export type HistoricalTodayEvent = {
  year?: number;
  text?: string;
  parts?: HistoricalTodayEventPart[];
  yearHref?: string | null;
};

export type HistoricalTodayEventPart = {
  text: string;
  href?: string | null;
};

export type HistoricalTodayPayload = {
  date: string;
  fetchedAt: string;
  available: boolean;
  events: HistoricalTodayEvent[];
};

const CACHE_TTL_MS = 60 * 60 * 1000;
let cached: { key: string; expiresAt: number; value: HistoricalTodayPayload } | null = null;
let inFlight: Promise<HistoricalTodayPayload> | null = null;

function currentHourKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}`;
}

export function getHistoricalToday() {
  const key = currentHourKey();
  if (cached && cached.key === key && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (inFlight) return inFlight;

  inFlight = apiGet<HistoricalTodayPayload>("/historical-today")
    .then((payload) => {
      cached = { key, expiresAt: Date.now() + CACHE_TTL_MS, value: payload };
      return payload;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

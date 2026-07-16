"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { resolveApiUrl } from "./lib/api/client";
import { type ArticleSummary, getAllPublishedArticles, getLocalArticleDetail, getLocalArticleIndex, getPublishedArticle, getPublishedArticles, isAbortError } from "./lib/api/articles";
import { getChatterEntries, getLocalChatterIndex, type ChatterSummary } from "./lib/api/chatter";
import { type HistoricalTodayEvent, getHistoricalToday } from "./lib/api/historical";
import { getMusicPlaylist, getMusicTrackUrl, type MusicTrackSummary } from "./lib/api/music";
import { MaintenancePage } from "./components/MaintenancePage";

type PageKey = "home" | "projects" | "about" | "article" | "chatter";

const navigation: { id: PageKey; label: string; index: string }[] = [
  { id: "home", label: "Home", index: "01" },
  { id: "projects", label: "Projects", index: "02" },
  { id: "about", label: "About", index: "03" },
  { id: "article", label: "Article", index: "04" },
  { id: "chatter", label: "Dairy", index: "05" },
];

const coverImages = ["1.png", "2.jpg", "3.png","4.png"].sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));

const projects = [
  { title: "Luma Notes", type: "Product / 2026", description: "A quiet place for ideas, fragments, and the things worth keeping.", color: "lilac" },
  { title: "Orbit / 01", type: "Experiment / 2025", description: "A small interactive study of light, distance, and moving slowly.", color: "mint" },
  { title: "Slow Internet", type: "Editorial / 2025", description: "Notes on attention, digital gardens, and making room for thought.", color: "peach" },
];

const fallbackArticleList: ArticleSummary[] = [
  {
    id: "fallback-first-note",
    slug: "first-note",
    title: "First note",
    summary: "The first sample article served by the Java API.",
    coverUrl: "/articles/first-note/cover.svg",
    tags: ["notes"],
    status: "PUBLISHED",
    publishedAt: "2026-07-14T12:00:00Z",
    createdAt: "2026-07-14T12:00:00Z",
    updatedAt: "2026-07-14T12:00:00Z",
  },
];

const articleMaskColors: Record<string, string> = {
  "first-note": "110 101 127",
  "quiet-corner": "153 129 141",
  "building-a-place-for-notes": "112 137 134",
  "the-weather-of-a-day": "163 135 117",
  "small-things-worth-keeping": "158 132 118",
};

function formatArticleCreatedAt(value: string | null) {
  if (!value) return { date: "----.--.--", time: "--:--" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "----.--.--", time: "--:--" };
  return {
    date: `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`,
    time: new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date),
  };
}

function getArticlePreviewLines(markdown: string) {
  return markdown
    .replace(/^---[\s\S]*?---\s*/u, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s/.test(line) && !/^```/.test(line) && !/^---+$/.test(line))
    .map((line) => line.replace(/^>\s?/, "").replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").replace(/[`*_]/g, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

type MusicTrack = MusicTrackSummary & { cover: string; src: string };

const netEasePlaylist = {
  id: "17434435787",
  url: "https://music.163.com/playlist?id=17434435787&uct2=U2FsdGVkX1/aYcJTaeB05yIdBqaMhTtFRVoB4Mt6mAg=",
};

const emptyMusicTrack: MusicTrack = {
  id: "",
  title: "暂无歌曲",
  artist: "",
  album: null,
  coverUrl: null,
  durationMs: null,
  canPlay: false,
  freeTrial: false,
  cover: "",
  src: "",
};

const lunarDayNames = ["", "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];

const lunarFestivals: Record<string, string> = {
  "1-1": "春节",
  "1-15": "元宵节",
  "2-2": "龙抬头",
  "5-5": "端午节",
  "7-7": "七夕",
  "7-15": "中元节",
  "8-15": "中秋节",
  "9-9": "重阳节",
  "12-8": "腊八节",
};

const solarFestivals: Record<string, string> = {
  "1-1": "元旦",
  "2-14": "情人节",
  "3-8": "妇女节",
  "5-1": "劳动节",
  "6-1": "儿童节",
  "7-1": "建党节",
  "8-1": "建军节",
  "9-10": "教师节",
  "10-1": "国庆节",
  "12-25": "圣诞节",
};

const datedCalendarEvents: Record<string, string> = {
  "2026-7-7": "小暑",
  "2026-7-23": "大暑",
};

const chineseCalendar = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric" });
const lunarMonthNumbers: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };

function getLunarParts(date: Date) {
  const parts = chineseCalendar.formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = Number(parts.find((part) => part.type === "day")?.value ?? 0);
  return { month, day };
}

function getCalendarDetail(date: Date) {
  const lunarParts = getLunarParts(date);
  const lunarMonthNumber = lunarMonthNumbers[lunarParts.month.replace("闰", "")] ?? 0;
  const lunar = `${lunarParts.month}${lunarDayNames[lunarParts.day] ?? `${lunarParts.day}日`}`;
  const solarKey = `${date.getMonth() + 1}-${date.getDate()}`;
  const datedKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  const nextLunar = getLunarParts(nextDate);
  const nextLunarMonthNumber = Number(nextLunar.month.replace(/[^0-9一二三四五六七八九十]/g, "")) || 0;
  const event = datedCalendarEvents[datedKey]
    ?? solarFestivals[solarKey]
    ?? lunarFestivals[`${lunarMonthNumber}-${lunarParts.day}`]
    ?? (lunarMonthNumber === 12 && nextLunarMonthNumber === 1 && nextLunar.day === 1 ? "除夕" : undefined);

  return { lunar, lunarDay: lunarDayNames[lunarParts.day] ?? `${lunarParts.day}日`, event };
}

type WeatherState = {
  location: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  code: number;
};

type WeatherStatus = "loading" | "ready" | "denied" | "error" | "unsupported";

const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;
const weatherCache = new Map<string, { value: WeatherState; expiresAt: number }>();
const weatherRequests = new Map<string, Promise<WeatherState>>();

function weatherCacheKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

async function requestWeather(latitude: number, longitude: number): Promise<WeatherState> {
  const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
  weatherUrl.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
    timezone: "auto",
  }).toString();
  const weatherResponse = await fetch(weatherUrl);
  if (!weatherResponse.ok) throw new Error("weather request failed");
  const weatherPayload = await weatherResponse.json() as { current?: Record<string, number> };
  if (!weatherPayload.current) throw new Error("weather data missing");

  let location = "当前位置";
  try {
    const locationUrl = new URL("https://nominatim.openstreetmap.org/reverse");
    locationUrl.search = new URLSearchParams({ lat: String(latitude), lon: String(longitude), format: "jsonv2", "accept-language": "zh-CN" }).toString();
    const locationResponse = await fetch(locationUrl);
    if (!locationResponse.ok) throw new Error("location request failed");
    const locationPayload = await locationResponse.json() as { address?: Record<string, string> };
    const address = locationPayload.address;
    const city = address?.state_district ?? address?.city ?? address?.municipality ?? address?.state;
    const district = address?.district ?? address?.city_district ?? (address?.county !== city ? address?.county : undefined);
    location = [city, district].filter((part, index, parts) => part && parts.indexOf(part) === index).join(" ") || location;
  } catch {
    // Weather still works when reverse geocoding is unavailable.
  }

  return {
    location,
    temperature: weatherPayload.current.temperature_2m,
    apparentTemperature: weatherPayload.current.apparent_temperature,
    humidity: weatherPayload.current.relative_humidity_2m,
    windSpeed: weatherPayload.current.wind_speed_10m,
    code: weatherPayload.current.weather_code,
  };
}

function getWeather(latitude: number, longitude: number) {
  const key = weatherCacheKey(latitude, longitude);
  const cached = weatherCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (cached) weatherCache.delete(key);
  const current = weatherRequests.get(key);
  if (current) return current;

  const request = requestWeather(latitude, longitude)
    .then((value) => {
      weatherCache.set(key, { value, expiresAt: Date.now() + WEATHER_CACHE_TTL_MS });
      return value;
    })
    .finally(() => {
      if (weatherRequests.get(key) === request) weatherRequests.delete(key);
    });
  weatherRequests.set(key, request);
  return request;
}

function getWeatherSummary(code: number) {
  if (code === 0) return { label: "晴", icon: "☀" };
  if (code <= 3) return { label: "多云", icon: "☁" };
  if (code === 45 || code === 48) return { label: "有雾", icon: "≋" };
  if (code <= 57) return { label: "毛毛雨", icon: "◌" };
  if (code <= 67 || code === 80 || code === 81 || code === 82) return { label: "有雨", icon: "雨" };
  if (code <= 77 || code === 85 || code === 86) return { label: "有雪", icon: "雪" };
  if (code >= 95) return { label: "雷雨", icon: "⚡" };
  return { label: "天气良好", icon: "◌" };
}

function useLocalWeather() {
  const [weather, setWeather] = useState<WeatherState | null>(null);
  const [status, setStatus] = useState<WeatherStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    if (!navigator.geolocation) {
      // This effect reports an external browser capability to the UI.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("unsupported");
      return () => { cancelled = true; };
    }

    navigator.geolocation.getCurrentPosition(({ coords }) => {
      getWeather(coords.latitude, coords.longitude)
        .then((value) => {
          if (cancelled) return;
          setWeather(value);
          setStatus("ready");
        })
        .catch(() => {
          if (!cancelled) setStatus("error");
        });
    }, () => {
      if (!cancelled) setStatus("denied");
    }, { enableHighAccuracy: false, maximumAge: 900000, timeout: 10000 });

    return () => { cancelled = true; };
  }, []);

  return { weather, status };
}

function HistoricalTodayPanel({ now }: { now: Date | null }) {
  const reference = now ?? new Date(2026, 6, 13);
  const month = String(reference.getMonth() + 1).padStart(2, "0");
  const day = String(reference.getDate()).padStart(2, "0");
  const dateKey = `${month}-${day}`;
  const hourKey = `${reference.getFullYear()}-${month}-${day}-${reference.getHours()}`;
  const dateLabel = `${reference.getMonth() + 1}月${reference.getDate()}日`;
  const [events, setEvents] = useState<HistoricalTodayEvent[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    // This state follows the selected calendar date and is intentionally reset for each day.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("loading");
    setEvents([]);

    getHistoricalToday()
      .then((payload) => {
        if (cancelled) return;
        setEvents([...(payload.events ?? [])]
          .sort((left, right) => (left.year ?? Number.MAX_SAFE_INTEGER) - (right.year ?? Number.MAX_SAFE_INTEGER))
          .slice(0, 5));
        setStatus(payload.available ? "ready" : "error");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });

    return () => { cancelled = true; };
  }, [dateKey, hourKey]);

  return (
    <section className="calendar-history" aria-label="历史上的今天">
      <div className="calendar-history__heading">
        <strong>歷史上的今天</strong>
        <span>{dateLabel}</span>
      </div>
      {status === "loading" ? <p className="calendar-history__status">正在读取当天事件…</p> : null}
      {status === "error" ? <p className="calendar-history__status">暂时无法读取维基百科</p> : null}
      {status === "ready" && !events.length ? <p className="calendar-history__status">这一天暂时没有可显示的条目</p> : null}
      <div className="calendar-history__events">
        {events.map((event, index) => {
          const content = event.text ?? "";
          return (
            <div className="calendar-history__event" key={`${content}-${index}`}>
              <strong>{event.year ?? "—"}</strong>
              <p>{content}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WeatherPanel() {
  const { weather, status: weatherStatus } = useLocalWeather();
  const weatherSummary = weather ? getWeatherSummary(weather.code) : { label: "天气", icon: "◌" };
  const weatherStatusCopy = weatherStatus === "loading"
    ? "正在请求位置授权…"
    : weatherStatus === "denied"
      ? "允许定位后显示当地天气"
      : weatherStatus === "unsupported"
        ? "当前浏览器不支持定位"
        : "天气服务暂时不可用";

  return (
    <div className="calendar-weather">
      <div className="calendar-weather__place">
        <span className="calendar-weather__icon" aria-hidden="true">{weatherSummary.icon}</span>
        <div><strong>{weather?.location ?? "你所在的地方"}</strong><small>{weather ? weatherSummary.label : weatherStatusCopy}</small></div>
      </div>
      {weather ? (
        <div className="calendar-weather__reading"><strong>{Math.round(weather.temperature)}°</strong><small>体感 {Math.round(weather.apparentTemperature)}° · 湿度 {weather.humidity}% · 风 {Math.round(weather.windSpeed)}km/h</small></div>
      ) : null}
    </div>
  );
}

function PageButton({ active, index, label, onClick }: { active: boolean; index: string; label: string; onClick: () => void }) {
  return (
    <button className={`page-button ${active ? "is-active" : ""}`} onClick={onClick} type="button" aria-current={active ? "page" : undefined}>
      <span>{index}</span>
      {label}
    </button>
  );
}

function CoverCarousel() {
  const [trackIndex, setTrackIndex] = useState(0);
  const [animateTrack, setAnimateTrack] = useState(true);
  const activeIndex = trackIndex % coverImages.length;

  useEffect(() => {
    if (coverImages.length <= 1) return;
    const timer = window.setInterval(() => {
      setTrackIndex((index) => (index >= coverImages.length ? 0 : index + 1));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [trackIndex]);

  useEffect(() => {
    const recoverCarousel = () => {
      if (document.visibilityState !== "visible") return;
      setTrackIndex((index) => index >= coverImages.length ? index % coverImages.length : index);
    };
    document.addEventListener("visibilitychange", recoverCarousel);
    window.addEventListener("pageshow", recoverCarousel);
    return () => {
      document.removeEventListener("visibilitychange", recoverCarousel);
      window.removeEventListener("pageshow", recoverCarousel);
    };
  }, []);

  const handleTrackTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.propertyName !== "transform" || trackIndex !== coverImages.length) return;
    setAnimateTrack(false);
    setTrackIndex(0);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setAnimateTrack(true));
    });
  };

  return (
    <div className="cover-space" aria-label="顶部封面图片轮播">
      <div className="cover-space__inner">
        <div
          className={`cover-space__track ${animateTrack ? "" : "is-resetting"}`}
          style={{ "--cover-slide-index": trackIndex } as React.CSSProperties}
          onTransitionEnd={handleTrackTransitionEnd}
        >
          {[...coverImages, coverImages[0]].map((image, index) => (
            <img className="cover-space__image" src={`/picture/Cover/${image}`} alt={`顶部封面 ${index + 1}`} key={`${image}-${index}`} />
          ))}
        </div>
        {coverImages.length > 1 ? (
          <div className="cover-space__dots" aria-label="选择顶部封面">
            {coverImages.map((image, index) => (
              <button
                className={`cover-space__dot ${index === activeIndex ? "is-active" : ""}`}
                type="button"
                key={image}
                aria-label={`切换到第 ${index + 1} 张封面`}
                aria-current={index === activeIndex ? "true" : undefined}
                disabled={index === activeIndex}
                onClick={() => { setAnimateTrack(true); setTrackIndex(index); }}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function useCurrentTime() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

function ClockDisplay({ now }: { now: Date | null }) {
  const time = now ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now).split("").join(" ") : "--:--";
  const gregorianDate = now ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(now) : "正在读取日期";
  const weekday = now ? new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(now) : "正在读取星期";
  const lunarParts = now ? getLunarParts(now) : null;
  const lunarDate = lunarParts ? `农历${lunarParts.month}${lunarDayNames[lunarParts.day] ?? `${lunarParts.day}日`}` : "正在读取农历";

  return (
    <section className="clock-display" aria-label="当前时间">
      <div className="clock-display__time">{time}</div>
      <div className="clock-display__date">
        <span>{gregorianDate}</span><i>/</i><span>{weekday}</span><i>/</i><span>{lunarDate}</span>
      </div>
    </section>
  );
}

function GlassHeader({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow"><span className="status-dot" />{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <p className="page-copy">{copy}</p>
    </div>
  );
}

function CalendarCard({ now }: { now: Date | null }) {
  const today = now ?? new Date(2026, 6, 13);
  const [viewDate, setViewDate] = useState<Date | null>(null);
  const reference = viewDate ?? today;
  const year = reference.getFullYear();
  const monthIndex = reference.getMonth();
  const month = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(reference);
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cellCount = 42;
  const calendarDays = Array.from({ length: cellCount }, (_, index) => {
    const day = index - firstDay + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const isViewingToday = year === today.getFullYear() && monthIndex === today.getMonth();
  const changeMonth = (offset: number) => {
    setViewDate(new Date(year, monthIndex + offset, 1));
  };
  return (
    <article className="glass-card calendar-card dashboard-card">
      <div className="calendar-card__month">
        <button className="calendar-nav-button" type="button" onClick={() => changeMonth(-1)} aria-label="查看上个月" title="上个月">‹</button>
        <span>{month}</span>
        <button className="calendar-nav-button" type="button" onClick={() => changeMonth(1)} aria-label="查看下个月" title="下个月">›</button>
      </div>
      <div className="calendar-grid">
        {weekdays.map((weekday) => <span className="calendar-weekday" key={weekday}>{weekday}</span>)}
        {calendarDays.map((day, index) => {
          const detail = day ? getCalendarDetail(new Date(year, monthIndex, day)) : undefined;
          return (
            <span className={`calendar-day ${isViewingToday && day === today.getDate() ? "is-today" : ""} ${detail?.event ? "has-event" : ""}`} key={`${day ?? "empty"}-${index}`} title={detail?.event}>
              {day ? <><b>{day}</b><small>{detail?.event ?? detail?.lunarDay ?? ""}</small></> : null}
            </span>
          );
        })}
      </div>
      <HistoricalTodayPanel now={now} />
    </article>
  );
}

function formatMusicTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function MusicPlayerBar({ compact = false }: { compact?: boolean }) {
  const volumeControlRef = useRef<HTMLDivElement | null>(null);
  const playlistControlRef = useRef<HTMLDivElement | null>(null);
  const playlistPopoverRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [playlistStatus, setPlaylistStatus] = useState<"loading" | "ready" | "error">("loading");
  const [playlistSource, setPlaylistSource] = useState<"local" | "netease">("local");
  const [playlistMessage, setPlaylistMessage] = useState<string | null>(null);
  const [loadingTrackUrl, setLoadingTrackUrl] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.72);
  const [showVolume, setShowVolume] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const trackUrlRequestsRef = useRef(new Map<string, Promise<string | null>>());
  const track = musicTracks[trackIndex] ?? emptyMusicTrack;

  useEffect(() => {
    let cancelled = false;
    getMusicPlaylist()
      .then((payload) => {
        if (cancelled) return;
        setMusicTracks(payload.tracks.map((item) => ({ ...item, cover: resolveApiUrl(item.coverUrl), src: "" })));
        setTrackIndex(0);
        setPlaylistSource(payload.source);
        setPlaylistMessage(payload.message);
        setPlaylistStatus(payload.available ? "ready" : "error");
      })
      .catch(() => {
        if (!cancelled) {
          setPlaylistMessage("歌单暂时无法读取，请检查后端音乐配置。");
          setPlaylistStatus("error");
        }
      });

    return () => { cancelled = true; };
  }, []);

  const requestTrackUrl = useCallback((selectedTrack: MusicTrack) => {
    if (!selectedTrack.id || !selectedTrack.canPlay) return Promise.resolve(null);
    if (selectedTrack.src) return Promise.resolve(selectedTrack.src);

    const existingRequest = trackUrlRequestsRef.current.get(selectedTrack.id);
    if (existingRequest) return existingRequest;

    const request = getMusicTrackUrl(selectedTrack.id)
      .then((payload) => {
        if (!payload.playUrl) return null;
        const source = resolveApiUrl(payload.playUrl);
        setMusicTracks((current) => current.map((item) => item.id === selectedTrack.id ? { ...item, src: source } : item));
        return source;
      })
      .catch(() => null)
      .finally(() => {
        trackUrlRequestsRef.current.delete(selectedTrack.id);
      });

    trackUrlRequestsRef.current.set(selectedTrack.id, request);
    return request;
  }, []);

  useEffect(() => {
    if (playlistStatus !== "ready" || !track.id || !track.canPlay || track.src) return;

    void requestTrackUrl(track);
  }, [playlistStatus, requestTrackUrl, track]);

  useEffect(() => {
    const audio = audioRef.current;
    // Reset playback state when the selected external audio resource changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentTime(0);
    setDuration(track.durationMs && track.durationMs > 0 ? track.durationMs / 1000 : 0);
    setIsPlaying(false);
    audio?.pause();
    audio?.load();
  }, [track.durationMs, trackIndex]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!showVolume && !showPlaylist) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const insideVolume = volumeControlRef.current?.contains(event.target) ?? false;
      const insidePlaylist = (playlistControlRef.current?.contains(event.target) ?? false) || (playlistPopoverRef.current?.contains(event.target) ?? false);
      if (!insideVolume) setShowVolume(false);
      if (!insidePlaylist) setShowPlaylist(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowVolume(false);
        setShowPlaylist(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showPlaylist, showVolume]);

  const changeTrack = (offset: number) => {
    if (!musicTracks.length) return;
    setTrackIndex((index) => (index + offset + musicTracks.length) % musicTracks.length);
  };

  const ensureTrackUrl = async (selectedTrack: MusicTrack) => {
    if (!selectedTrack.id) return null;
    if (selectedTrack.src) return selectedTrack.src;

    setLoadingTrackUrl(true);
    try {
      return await requestTrackUrl(selectedTrack);
    } finally {
      setLoadingTrackUrl(false);
    }
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !track.id || !track.canPlay || loadingTrackUrl) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }

    const source = await ensureTrackUrl(track);
    if (!source) return;
    audio.src = source;
    audio.load();
    if (currentTime > 0) audio.currentTime = currentTime;
    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
    }
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.src) audio.currentTime = value;
    setCurrentTime(value);
  };

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className={`music-player-block ${compact ? "music-player-block--compact" : ""} ${showPlaylist ? "is-playlist-open" : ""}`}>
      <article className="music-player-bar">
        <div className="music-bar__track-info">
          <div className={`music-bar__cover ${isPlaying ? "is-playing" : ""}`} style={track.cover ? { backgroundImage: `url(${track.cover})` } : undefined} />
          {track.title || track.artist ? <div className={`music-bar__track-label ${track.artist ? "" : "is-single"}`}><strong>{track.title}</strong>{track.artist ? <><span className="music-bar__separator"> - </span><small>{track.artist}</small></> : null}</div> : null}
        </div>
        <div className="music-bar__center">
          <div className="music-bar__transport">
            <div ref={volumeControlRef} className="music-volume-control">
              <button type="button" aria-label="显示音量" aria-expanded={showVolume} onClick={() => { setShowVolume((visible) => !visible); setShowPlaylist(false); }}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 10v4h4l5 4V6l-5 4H4Zm12.5-1.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12" /></svg></button>
              {showVolume ? <div className="music-popover music-volume-popover"><input aria-label="音量" type="range" min="0" max="1" step="0.01" value={volume} style={{ "--volume-progress": `${volume * 100}%` } as React.CSSProperties} onChange={(event) => setVolume(Number(event.target.value))} /></div> : null}
            </div>
            <button type="button" aria-label="上一首" onClick={() => changeTrack(-1)} disabled={!musicTracks.length}>◀</button>
            <button className="music-bar__play" type="button" aria-label={loadingTrackUrl || !track.src ? "加载播放地址" : isPlaying ? "暂停" : "播放"} onClick={togglePlayback} disabled={!track.id || !track.canPlay || !track.src || loadingTrackUrl}>{loadingTrackUrl || !track.src ? "…" : isPlaying ? "Ⅱ" : "▶"}</button>
            <button type="button" aria-label="下一首" onClick={() => changeTrack(1)} disabled={!musicTracks.length}>▶</button>
            <div ref={playlistControlRef} className="music-playlist-control">
              <button type="button" aria-label="显示歌单" aria-expanded={showPlaylist} onClick={() => { setShowPlaylist((visible) => !visible); setShowVolume(false); }}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14" /></svg></button>
              {showPlaylist ? (
                <div ref={playlistPopoverRef} className="music-popover music-playlist-popover">
                  <div><strong>{playlistSource === "local" ? "本地歌单" : "网易云歌单"}</strong>{playlistSource === "netease" ? <small>ID {netEasePlaylist.id}</small> : null}</div>
                  {playlistSource === "netease" ? <a href={netEasePlaylist.url} target="_blank" rel="noreferrer">打开歌单 ↗</a> : null}
                  {playlistStatus === "loading" ? <p>正在读取歌单…</p> : null}
                  {playlistStatus === "error" ? <p>{playlistMessage ?? "歌单暂时无法读取，请检查后端音乐配置。"}</p> : null}
                  {playlistStatus === "ready" ? (
                    <div className="music-playlist-popover__tracks">
                      {musicTracks.map((item, index) => (
                        <button className={`music-playlist-popover__track ${item.canPlay ? "" : "is-unavailable"}`} type="button" key={item.id || `${item.title}-${index}`} onClick={() => { setTrackIndex(index); setShowPlaylist(false); }}>
                          <span className="music-playlist-popover__track-number">{index + 1}</span>
                          <span className="music-playlist-popover__track-info">
                            <span className="music-playlist-popover__track-title">{item.title || "未命名歌曲"}</span>
                            <span className="music-playlist-popover__track-artist">{item.artist || "未知作者"}{item.canPlay ? "" : " · 暂不可播放"}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          {duration > 0 ? (
            <div className="music-bar-progress">
              <input aria-label="播放进度" type="range" min="0" max={duration} step="0.1" value={Math.min(currentTime, duration)} style={{ "--music-progress": `${progressPercent}%` } as React.CSSProperties} onChange={(event) => seek(Number(event.target.value))} />
            </div>
          ) : null}
          <div className="music-bar__time"><span>{formatMusicTime(currentTime)}</span><span>{formatMusicTime(duration)}</span></div>
        </div>
        <div className="music-bar__actions">
          {playlistSource === "netease" ? <button type="button" aria-label="打开网易云歌单" onClick={() => window.open(netEasePlaylist.url, "_blank", "noopener,noreferrer")}>↗</button> : null}
        </div>
        <audio ref={audioRef} src={track.src || undefined} preload="metadata" onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => { setIsPlaying(false); setCurrentTime(0); if (audioRef.current) audioRef.current.currentTime = 0; }} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} />
      </article>
    </div>
  );
}

function HomeArticleCard({ article, onOpenArticle }: { article: ArticleSummary; onOpenArticle: (slug: string) => void }) {
  const [isHovered, setIsHovered] = useState(false);
  const [previewLines, setPreviewLines] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => previewAbortRef.current?.abort(), []);

  const loadPreview = async (signal: AbortSignal) => {
    if (previewLines.length || previewLoading) return;
    setPreviewLoading(true);
    try {
      const detail = await getPublishedArticle(article.slug, signal);
      if (signal.aborted) return;
      setPreviewLines(getArticlePreviewLines(detail.contentMarkdown));
    } catch (error) {
      if (isAbortError(error)) return;
      setPreviewLines(article.summary ? [article.summary] : []);
    } finally {
      if (previewAbortRef.current?.signal === signal) setPreviewLoading(false);
    }
  };

  const handleHover = () => {
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setIsHovered(true);
    void loadPreview(controller.signal);
  };

  return (
    <button
      className={`glass-card article-list-card article-list-card--home ${article.coverUrl ? "has-cover" : ""} ${isHovered ? "is-hovered" : ""}`}
      type="button"
      onClick={() => onOpenArticle(article.slug)}
      onMouseEnter={handleHover}
      onMouseLeave={() => { setIsHovered(false); previewAbortRef.current?.abort(); }}
      onFocus={handleHover}
      onBlur={() => { setIsHovered(false); previewAbortRef.current?.abort(); }}
      style={{ "--article-mask-rgb": articleMaskColors[article.slug] ?? "110 101 127" } as React.CSSProperties}
    >
      {article.coverUrl ? (
        <>
          <img className="article-list-card__cover" src={article.coverUrl} alt="" loading="eager" decoding="async" />
          <div className="article-list-card__mask">
            <h2 className="article-list-card__mask-title">{article.title}</h2>
            <div className="article-list-card__preview" aria-live="polite"><div className="article-list-card__preview-copy">{isHovered ? (previewLoading ? <span>正在读取正文…</span> : previewLines.map((line, lineIndex) => <span key={`${article.slug}-home-preview-${lineIndex}`}>{line}</span>)) : null}</div></div>
          </div>
          <div className="article-list-card__bottom-bar" aria-hidden="true" />
        </>
      ) : <h2>{article.title}</h2>}
    </button>
  );
}

function HomePage({ onPageChange, onOpenArticle, now }: { onPageChange: (page: PageKey) => void; onOpenArticle: (slug: string) => void; now: Date | null }) {
  const [latestArticles, setLatestArticles] = useState<ArticleSummary[]>([]);
  const [chatterEntries, setChatterEntries] = useState<ChatterSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    getPublishedArticles(0, 3)
      .then((result) => {
        if (!cancelled) setLatestArticles(result.content);
      })
      .catch(() => {
        getLocalArticleIndex()
          .then((result) => {
            if (!cancelled) setLatestArticles(result.slice(0, 3));
          })
          .catch(() => {
            // Keep the bundled sample post when the Java API and local index are unavailable.
          });
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getChatterEntries(0, 3)
      .then((result) => {
        if (!cancelled) setChatterEntries(result.content.slice(0, 3));
      })
      .catch(() => {
        getLocalChatterIndex()
          .then((result) => {
            if (!cancelled) setChatterEntries(result.slice(0, 3));
          })
          .catch(() => {
            if (!cancelled) setChatterEntries([]);
          });
      });

    return () => { cancelled = true; };
  }, []);

  const latestArticle = latestArticles[0] ?? fallbackArticleList[0];

  return (
    <>
      <div className="dashboard-grid">
        <article className="glass-card profile-card dashboard-card dashboard-card--profile">
          <div className="card-topline profile-card__topline"><span>Profile</span><span>•••</span></div>
          <div className="profile-main">
            <div className="avatar">
              <img src="/picture/portrait.png" alt="Profile portrait" />
            </div>
            <div>
              <h2>S t r I n</h2>
              <p className="profile-bio">
                大三、半传统派、喜欢摆烂、社恐到线上。爱好是打机、写歌、看书 <br />
                主力：C++、C#<br />
                比较擅长：Qt、Unity、Winform<br />
                会一点：Postgress、Redis、LangGraph、Docker Compose、Godot、Spring Boot
              </p>
            </div>
          </div>
          <div className="profile-bottom">
            <div className="profile-actions">
              <a className="profile-action" href="https://github.com/hhd233cored" target="_blank" rel="noreferrer" aria-label="GitHub">
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 2.5a9.5 9.5 0 0 0-3 18.51c.48.09.66-.21.66-.46v-1.68c-2.7.59-3.27-1.14-3.27-1.14-.44-1.13-1.08-1.43-1.08-1.43-.88-.6.07-.59.07-.59.97.07 1.48.99 1.48.99.87 1.48 2.28 1.05 2.84.8.09-.63.34-1.05.62-1.29-2.16-.25-4.43-1.08-4.43-4.81 0-1.06.38-1.93.99-2.61-.1-.25-.43-1.31.09-2.58 0 0 .81-.26 2.63 1a9.1 9.1 0 0 1 4.8 0c1.82-1.26 2.63-1 2.63-1 .52 1.27.19 2.33.09 2.58.62.68.99 1.55.99 2.61 0 3.74-2.27 4.56-4.44 4.8.35.3.66.88.66 1.78v2.64c0 .25.18.55.67.46A9.5 9.5 0 0 0 12 2.5Z" /></svg>
              </a>
              <button className="profile-action profile-action--email" type="button" aria-label="复制邮箱" data-tooltip="st2073181270@outlook.com（点击复制）" onClick={() => void navigator.clipboard?.writeText("st2073181270@outlook.com")}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3.5 5.5h17v13h-17zM4 6l8 6 8-6" /></svg>
              </button>
            </div>
          </div>
        </article>

        <MusicPlayerBar compact />

        <CalendarCard now={now} />

        <div className="feed-column">
          <article className="glass-card posts-card dashboard-card">
            <div className="card-heading"><div><p className="card-kicker">Latest Article</p><h2>最新文章</h2></div><button className="more-button" type="button" onClick={() => onPageChange("article")}>更多</button></div>
            <HomeArticleCard article={latestArticle} onOpenArticle={onOpenArticle} />
          </article>

          <div className="dashboard-split">
            <article className="glass-card chatter-card dashboard-card">
              <div className="small-card-heading"><p className="card-kicker">说说</p><button className="more-button" type="button" onClick={() => onPageChange("chatter")}>更多</button></div>
              <div className="chatter-list">
                {chatterEntries.length > 0 ? chatterEntries.map((entry) => (
                  <div className="chatter-bubble" key={entry.id ?? entry.slug}>
                    <span className="chatter-bubble__text">{entry.preview}</span>
                  </div>
                )) : <div className="chatter-bubble chatter-bubble--empty">暂无说说</div>}
              </div>
            </article>
            <article className="glass-card diary-card dashboard-card">
              <WeatherPanel />
            </article>
          </div>
        </div>

      </div>
    </>
  );
}

function ProjectsPage() {
  return (
    <>
      <GlassHeader eyebrow="Archive / 02" title="Selected projects." copy="几个持续更新的实验。这里先用静态数据占位，之后可以接入你的真实项目。" />
      <div className="projects-layout">
        <div className="project-stack">
          {projects.map((project, index) => (
            <article className="glass-card project-row" key={project.title}>
              <div className={`project-visual project-visual--${project.color}`}><div className="project-orbit" /><span>0{index + 1}</span></div>
              <div className="project-row__body"><p className="card-kicker">{project.type}</p><h2>{project.title}</h2><p className="muted-copy">{project.description}</p><div className="tag-list"><span>Design</span><span>Making</span><span>Notes</span></div></div>
              <span className="round-arrow">↗</span>
            </article>
          ))}
        </div>
        <aside className="glass-card project-index">
          <p className="card-kicker">Project index</p>
          <div className="index-list"><span><b>01</b> Luma Notes</span><span><b>02</b> Orbit / 01</span><span><b>03</b> Slow Internet</span></div>
          <div className="card-footer">Built slowly, with care.</div>
        </aside>
      </div>
    </>
  );
}

function AboutPage() {
  return (
    <>
      <GlassHeader eyebrow="A little context / 03" title="A person behind the pixels." copy="一个很简单的自我介绍页面，先保持轻量，后续可以继续加履历、链接和更多个人内容。" />
      <div className="about-layout">
        <article className="glass-card about-card about-card--intro"><div className="avatar avatar--large">YN</div><p className="card-kicker">A note from me</p><p className="about-lede">我喜欢把复杂的东西变简单，把模糊的感受变成清晰的形状。好的设计像一扇门，不抢你的注意力，但会让你愿意多走一步。</p><span className="signature">YN ✳</span></article>
        <article className="glass-card about-card"><p className="card-kicker">Toolkit</p><div className="toolkit-list"><span>Figma</span><span>React</span><span>TypeScript</span><span>Writing</span><span>摄影</span><span>散步</span></div><div className="card-footer">Always learning ∞</div></article>
        <article className="glass-card about-card about-card--now"><p className="card-kicker">Now / July</p><h2>Building something gentle.</h2><div className="now-line"><span /></div><div className="card-footer">Reading Ursula K. Le Guin ↗</div></article>
      </div>
    </>
  );
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[2] && match[3]) {
      nodes.push(<a href={match[3]} key={`link-${match.index}`} target="_blank" rel="noreferrer">{match[2]}</a>);
    } else if (match[4]) {
      nodes.push(<code key={`code-${match.index}`}>{match[4]}</code>);
    } else if (match[5]) {
      nodes.push(<strong key={`strong-${match.index}`}>{match[5]}</strong>);
    } else if (match[6]) {
      nodes.push(<em key={`em-${match.index}`}>{match[6]}</em>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MarkdownContent({ source }: { source: string }) {
  const lines = source.replace(/^---[\s\S]*?---\s*/u, "").split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(<p key={`paragraph-${blocks.length}`}>{renderInlineMarkdown(paragraph.join(" "))}</p>);
      paragraph = [];
    }
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const Heading = `h${heading[1].length}` as "h1" | "h2" | "h3";
      blocks.push(<Heading key={`heading-${index}`}>{renderInlineMarkdown(heading[2])}</Heading>);
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`}>{renderInlineMarkdown(quoteLines.join(" "))}</blockquote>);
      continue;
    }

    if (line.startsWith("```")) {
      flushParagraph();
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(<pre key={`code-block-${index}`} data-language={language || undefined}><code>{codeLines.join("\n")}</code></pre>);
      continue;
    }

    if (/^([-*])\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length && /^([-*])\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>)}</ul>);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(<ol key={`ordered-list-${index}`}>{items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>)}</ol>);
      continue;
    }

    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      flushParagraph();
      blocks.push(<figure key={`image-${index}`}><img src={image[2]} alt={image[1]} /><figcaption>{image[1]}</figcaption></figure>);
      index += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushParagraph();
      blocks.push(<hr key={`rule-${index}`} />);
      index += 1;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }
  flushParagraph();

  return <div className="markdown-content">{blocks}</div>;
}

function ArticleListPage({ onOpenArticle }: { onOpenArticle: (slug: string) => void }) {
  const pageSize = 5;
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string[]>>({});
  const [previewLoadingSlug, setPreviewLoadingSlug] = useState<string | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => previewAbortRef.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    getAllPublishedArticles()
      .then((result) => {
        if (!cancelled) {
          setArticles(result);
          setCurrentPage(0);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          getLocalArticleIndex()
            .then((result) => {
              if (!cancelled) {
                setArticles(result);
                setCurrentPage(0);
                setStatus("fallback");
              }
            })
            .catch(() => {
              if (!cancelled) {
                setArticles(fallbackArticleList);
                setCurrentPage(0);
                setStatus("fallback");
              }
            });
        }
      });

    return () => { cancelled = true; };
  }, []);

  const loadPreview = async (slug: string, signal: AbortSignal) => {
    if (Object.prototype.hasOwnProperty.call(previews, slug) || previewLoadingSlug === slug) return;
    setPreviewLoadingSlug(slug);
    try {
      let markdown = "";
      try {
        const article = await getPublishedArticle(slug, signal);
        markdown = article.contentMarkdown;
      } catch {
        if (signal.aborted) return;
        const response = await fetch(`/articles/${encodeURIComponent(slug)}/article.md`, { signal, headers: { Accept: "text/markdown" } });
        if (!response.ok) throw new Error("preview fallback request failed");
        markdown = await response.text();
      }
      if (signal.aborted) return;
      setPreviews((current) => ({ ...current, [slug]: getArticlePreviewLines(markdown) }));
    } catch (error) {
      if (isAbortError(error)) return;
      setPreviews((current) => ({ ...current, [slug]: [] }));
    } finally {
      if (!signal.aborted) setPreviewLoadingSlug(null);
    }
  };

  const handleArticleHover = (slug: string) => {
    if (hoveredSlug === slug) return;
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setHoveredSlug(slug);
    void loadPreview(slug, controller.signal);
  };

  const handleArticleLeave = () => {
    previewAbortRef.current?.abort();
    setHoveredSlug(null);
    setPreviewLoadingSlug(null);
  };

  const totalPages = Math.max(1, Math.ceil(articles.length / pageSize));
  const visibleArticles = articles.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const goToPage = (page: number) => {
    const nextPage = Math.min(Math.max(page, 0), totalPages - 1);
    previewAbortRef.current?.abort();
    setHoveredSlug(null);
    setPreviewLoadingSlug(null);
    setCurrentPage(nextPage);
  };

  return (
    <div className="article-page article-list-page">
      <div className="article-list-stack">
        <div className="article-list-heading">
          <h1>Article</h1>
        </div>

        {status === "loading" ? <p className="article-state">正在读取文章列表…</p> : null}
        {status === "fallback" ? <p className="article-list-note">Java API 暂不可用，当前显示本地示例文章。</p> : null}
        {status !== "loading" ? (
          <div className="article-timeline" aria-label="文章列表">
            {visibleArticles.map((article) => {
              const createdAt = formatArticleCreatedAt(article.createdAt);
              const isHovered = hoveredSlug === article.slug;
              return (
                <div className="article-timeline-item" key={article.id}>
                  <time className="article-timeline-date" dateTime={article.createdAt ?? undefined}><strong>{createdAt.date}</strong><span>{createdAt.time}</span></time>
                  <span className="article-timeline-dot" aria-hidden="true" />
                  <button
                    className={`glass-card article-list-card ${article.coverUrl ? "has-cover" : ""} ${isHovered ? "is-hovered" : ""}`}
                    type="button"
                    onClick={() => onOpenArticle(article.slug)}
                    onMouseEnter={() => handleArticleHover(article.slug)}
                    onMouseLeave={handleArticleLeave}
                    onFocus={() => handleArticleHover(article.slug)}
                    onBlur={handleArticleLeave}
                    style={{ "--article-mask-rgb": articleMaskColors[article.slug] ?? "110 101 127" } as React.CSSProperties}
                  >
                    {article.coverUrl ? (
                      <>
                        <img className="article-list-card__cover" src={article.coverUrl} alt="" loading="lazy" decoding="async" />
                        <div className="article-list-card__mask">
                          <h2 className="article-list-card__mask-title">{article.title}</h2>
                          <div className="article-list-card__preview" aria-live="polite"><div className="article-list-card__preview-copy">{isHovered ? (previewLoadingSlug === article.slug ? <span>正在读取正文…</span> : previews[article.slug]?.map((line, lineIndex) => <span key={`${article.slug}-preview-${lineIndex}`}>{line}</span>)) : null}</div></div>
                        </div>
                        <div className="article-list-card__bottom-bar" aria-hidden="true" />
                      </>
                    ) : (
                      <>
                        <h2>{article.title}</h2>
                        {article.summary ? <p>{article.summary}</p> : null}
                        <div className="article-list-card__preview" aria-live="polite"><div className="article-list-card__preview-copy">{isHovered ? (previewLoadingSlug === article.slug ? <span>正在读取正文…</span> : previews[article.slug]?.map((line, lineIndex) => <span key={`${article.slug}-preview-${lineIndex}`}>{line}</span>)) : null}</div></div>
                        <div className="article-list-card__bottom">
                          <div className="article-list-card__tags">{article.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                          <span className="article-list-card__arrow">↗</span>
                        </div>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {status !== "loading" && totalPages > 1 ? (
          <nav className="article-pagination" aria-label="文章列表分页">
            <button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 0}>上一页</button>
            <div className="article-pagination__pages">
              {Array.from({ length: totalPages }, (_, page) => (
                <button key={page} className={page === currentPage ? "is-active" : ""} type="button" aria-current={page === currentPage ? "page" : undefined} onClick={() => goToPage(page)}>{page + 1}</button>
              ))}
            </div>
            <button type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages - 1}>下一页</button>
          </nav>
        ) : null}
      </div>
    </div>
  );
}

function formatChatterDate(value: string | null) {
  if (!value) return "—";
  return value.slice(0, 10).replaceAll("-", ".");
}

function ChatterPage({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<ChatterSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    getChatterEntries(0, 50)
      .then((result) => {
        if (!cancelled) {
          setEntries(result.content);
          setStatus("ready");
        }
      })
      .catch(() => {
        getLocalChatterIndex()
          .then((result) => {
            if (!cancelled) {
              setEntries(result);
              setStatus("fallback");
            }
          })
          .catch(() => {
            if (!cancelled) setStatus("error");
          });
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="article-page chatter-page">
      <div className="article-stack">
        <button className="article-back-button" type="button" onClick={onBack}>← 返回首页</button>
        <div className="article-cover-space chatter-cover-space" aria-label="说说头图">
          <span className="chatter-cover-space__title">Dairy</span>
          <span className="chatter-cover-space__hint">Small thoughts, kept gently.</span>
        </div>
        <article className="glass-card article-card chatter-detail-card">
          <div className="article-card__meta"><span>Dairy</span><span>{entries.length} small notes</span></div>
          {status === "loading" ? <p className="article-state">正在读取说说…</p> : null}
          {status === "fallback" ? <p className="article-list-note">Python API 暂不可用，当前显示本地说说。</p> : null}
          {status === "error" ? <p className="article-state">暂时无法读取说说，请检查后端或本地文件。</p> : null}
          {status !== "loading" && status !== "error" ? (
            <div className="chatter-detail-list">
              {entries.map((entry) => {
                const date = entry.publishedAt ?? entry.createdAt;
                return (
                  <article className="chatter-detail-entry" key={entry.id ?? entry.slug}>
                    <time dateTime={date ?? undefined}>{formatChatterDate(date)}</time>
                    <p>{entry.preview}</p>
                  </article>
                );
              })}
            </div>
          ) : null}
        </article>
      </div>
    </div>
  );
}

function ArticleDetailPage({ slug, onBack }: { slug: string; onBack: () => void }) {
  const [source, setSource] = useState("");
  const [articleTitle, setArticleTitle] = useState("Markdown document");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    const loadArticle = async () => {
      try {
        const article = await getPublishedArticle(slug);
        if (!cancelled) {
          setSource(article.contentMarkdown);
          setArticleTitle(article.title);
          setCoverUrl(article.coverUrl);
          setStatus("ready");
        }
        return;
      } catch {
        // Fall back to the bundled Markdown demo while the Java API is offline.
      }

      try {
        const localArticle = await getLocalArticleDetail(slug);
        if (!cancelled) {
          setSource(localArticle.contentMarkdown);
          setArticleTitle(localArticle.title);
          setCoverUrl(localArticle.coverUrl);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    };

    void loadArticle();

    return () => { cancelled = true; };
  }, [slug]);

  return (
    <div className="article-page">
      <div className="article-stack">
        <button className="article-back-button" type="button" onClick={onBack}>← 返回文章列表</button>
        <div
          className={`article-cover-space ${coverUrl ? "has-image" : ""}`}
          aria-label="文章头图"
        >
          {coverUrl ? <img className="article-cover-space__image" src={coverUrl} alt="" loading="eager" decoding="async" /> : null}
        </div>
        <article className="glass-card article-card">
          <div className="article-card__meta"><span>{articleTitle}</span></div>
          {status === "loading" ? <p className="article-state">正在读取 Markdown…</p> : null}
          {status === "error" ? <p className="article-state">暂时无法读取文章内容，请检查 Java API 或 Markdown 文件。</p> : null}
          {status === "ready" ? <MarkdownContent source={source} /> : null}
        </article>
      </div>
    </div>
  );
}

function SiteApp() {
  const [activePage, setActivePage] = useState<PageKey>("home");
  const [selectedArticleSlug, setSelectedArticleSlug] = useState<string | null>(null);
  const now = useCurrentTime();

  useEffect(() => {
    const moveToInitialPosition = () => {
      const maxScrollTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.round(maxScrollTop * 0.4));
    };
    const frame = window.requestAnimationFrame(moveToInitialPosition);
    const timer = window.setTimeout(moveToInitialPosition, 180);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <main className="site-shell">
      <div className="ambient ambient--one" aria-hidden="true" />
      <div className="ambient ambient--two" aria-hidden="true" />
      <div className="ambient ambient--three" aria-hidden="true" />
      <CoverCarousel />
      <header className="site-header">
        <div className="site-header__inner shell">
        <div className="brand"><span className="brand-mark">✦</span><span>YOUR <i>/</i> SPACE</span></div>
        <nav className="page-nav" aria-label="页面切换">
          {navigation.map((item) => <PageButton key={item.id} active={activePage === item.id} index={item.index} label={item.label} onClick={() => { setActivePage(item.id); setSelectedArticleSlug(null); }} />)}
        </nav>
        <div className="search-pill"><span>⌕</span><span>Search this space...</span><kbd>⌘ K</kbd></div>
        <div className="header-status"><span className="header-status__presence"><span className="status-dot" /> Online-ish</span></div>
        </div>
      </header>

      <div className={`content-backdrop content-backdrop--${activePage === "article" && selectedArticleSlug ? "article-detail" : activePage}`}>
        {activePage !== "article" && activePage !== "chatter" ? <ClockDisplay now={now} /> : null}

        <div className="workspace-shell shell">
          <div className={`home-page-layer ${activePage === "home" ? "" : "is-hidden"}`}>
            <HomePage onPageChange={setActivePage} onOpenArticle={(slug) => { setSelectedArticleSlug(slug); setActivePage("article"); }} now={now} />
          </div>
          {activePage === "projects" && <ProjectsPage />}
          {activePage === "about" && <AboutPage />}
          {activePage === "chatter" && <ChatterPage onBack={() => setActivePage("home")} />}
          {activePage === "article" && (selectedArticleSlug
            ? <ArticleDetailPage key={selectedArticleSlug} slug={selectedArticleSlug} onBack={() => setSelectedArticleSlug(null)} />
            : <ArticleListPage onOpenArticle={setSelectedArticleSlug} />)}
        </div>

        {activePage !== "article" ? <footer className="site-footer shell"><span>© 2026 StrIn</span><span>v.0.0.1</span></footer> : null}
      </div>
    </main>
  );
}

export default function Home() {
  const maintenanceMode = process.env.NEXT_PUBLIC_MAINTENANCE_MODE !== "false";
  return maintenanceMode ? <MaintenancePage /> : <SiteApp />;
}

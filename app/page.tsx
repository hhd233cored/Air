"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { type AuthUser, getCurrentUser, login, logout } from "./lib/api/auth";
import { type ArticleSummary, getAllPublishedArticles, getPublishedArticle, getPublishedArticles } from "./lib/api/articles";

type PageKey = "home" | "projects" | "about" | "article";

const navigation: { id: PageKey; label: string; index: string }[] = [
  { id: "home", label: "Home", index: "01" },
  { id: "projects", label: "Projects", index: "02" },
  { id: "about", label: "About", index: "03" },
  { id: "article", label: "Article", index: "04" },
];

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
    coverUrl: "/article-covers/first-note.svg",
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

type MusicTrack = { title: string; artist: string; cover: string; src: string };

const netEasePlaylist = {
  id: "17434435787",
  url: "https://music.163.com/playlist?id=17434435787&uct2=U2FsdGVkX1/aYcJTaeB05yIdBqaMhTtFRVoB4Mt6mAg=",
};

// Playlist tracks will be populated after the playlist API/proxy is connected.
const musicTracks: MusicTrack[] = [];
const emptyMusicTrack: MusicTrack = { title: "暂无歌曲", artist: "", cover: "", src: "" };

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

    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
        weatherUrl.search = new URLSearchParams({
          latitude: String(coords.latitude),
          longitude: String(coords.longitude),
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
          locationUrl.search = new URLSearchParams({ lat: String(coords.latitude), lon: String(coords.longitude), format: "jsonv2", "accept-language": "zh-CN" }).toString();
          const locationResponse = await fetch(locationUrl);
          const locationPayload = await locationResponse.json() as { address?: Record<string, string> };
          const address = locationPayload.address;
          const city = address?.state_district ?? address?.city ?? address?.municipality ?? address?.state;
          const district = address?.district ?? address?.city_district ?? (address?.county !== city ? address?.county : undefined);
          location = [city, district].filter((part, index, parts) => part && parts.indexOf(part) === index).join(" ") || location;
        } catch {
          // Weather still works when reverse geocoding is unavailable.
        }

        if (!cancelled) {
          setWeather({
            location,
            temperature: weatherPayload.current.temperature_2m,
            apparentTemperature: weatherPayload.current.apparent_temperature,
            humidity: weatherPayload.current.relative_humidity_2m,
            windSpeed: weatherPayload.current.wind_speed_10m,
            code: weatherPayload.current.weather_code,
          });
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    }, () => {
      if (!cancelled) setStatus("denied");
    }, { enableHighAccuracy: false, maximumAge: 900000, timeout: 10000 });

    return () => { cancelled = true; };
  }, []);

  return { weather, status };
}

function PageButton({ active, index, label, onClick }: { active: boolean; index: string; label: string; onClick: () => void }) {
  return (
    <button className={`page-button ${active ? "is-active" : ""}`} onClick={onClick} type="button" aria-current={active ? "page" : undefined}>
      <span>{index}</span>
      {label}
    </button>
  );
}

function AuthControls() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setUser(await login(username, password));
      setPassword("");
      setOpen(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await logout();
    } finally {
      setUser(null);
      setBusy(false);
    }
  };

  return (
    <div className="header-status">
      <span className="header-status__presence"><span className="status-dot" /> Online-ish</span>
      {!ready ? null : user ? (
        <div className="auth-logged-in">
          <span className="auth-user-label">{user.username} · {user.role === "ADMIN" ? "管理员" : "普通用户"}</span>
          <button className="auth-action-button" type="button" onClick={signOut} disabled={busy}>退出</button>
        </div>
      ) : (
        <button className="auth-action-button" type="button" onClick={() => { setOpen((visible) => !visible); setError(""); }} aria-expanded={open}>登录</button>
      )}
      {open && !user ? (
        <form className="auth-login-panel" onSubmit={submit}>
          <strong>登录</strong>
          <label>账号<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
          <label>密码<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {error ? <p role="alert">{error}</p> : null}
          <button type="submit" disabled={busy}>{busy ? "登录中…" : "确认登录"}</button>
        </form>
      ) : null}
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
  const time = now ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now) : "--:--";
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
  const { weather, status: weatherStatus } = useLocalWeather();
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
  const weatherSummary = weather ? getWeatherSummary(weather.code) : { label: "天气", icon: "◌" };
  const weatherStatusCopy = weatherStatus === "loading"
    ? "正在请求位置授权…"
    : weatherStatus === "denied"
      ? "允许定位后显示当地天气"
      : weatherStatus === "unsupported"
        ? "当前浏览器不支持定位"
        : "天气服务暂时不可用";

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
      <div className="calendar-weather">
        <div className="calendar-weather__place">
          <span className="calendar-weather__icon" aria-hidden="true">{weatherSummary.icon}</span>
          <div><strong>{weather?.location ?? "你所在的地方"}</strong><small>{weather ? weatherSummary.label : weatherStatusCopy}</small></div>
        </div>
        {weather ? (
          <div className="calendar-weather__reading"><strong>{Math.round(weather.temperature)}°</strong><small>体感 {Math.round(weather.apparentTemperature)}° · 湿度 {weather.humidity}% · 风 {Math.round(weather.windSpeed)}km/h</small></div>
        ) : null}
      </div>
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.72);
  const [showVolume, setShowVolume] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const track = musicTracks[trackIndex] ?? emptyMusicTrack;

  useEffect(() => {
    const audio = audioRef.current;
    // Reset playback state when the selected external audio resource changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    audio?.pause();
    audio?.load();
  }, [trackIndex]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const changeTrack = (offset: number) => {
    if (!musicTracks.length) return;
    setTrackIndex((index) => (index + offset + musicTracks.length) % musicTracks.length);
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !track.src) return;
    if (audio.paused) await audio.play();
    else audio.pause();
  };

  const seek = (value: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = value;
    setCurrentTime(value);
  };

  return (
    <div className={`music-player-block ${compact ? "music-player-block--compact" : ""}`}>
      <article className="music-player-bar">
        {duration > 0 ? (
          <div className="music-bar-progress">
            <input aria-label="播放进度" type="range" min="0" max={duration} step="0.1" value={Math.min(currentTime, duration)} onChange={(event) => seek(Number(event.target.value))} />
          </div>
        ) : null}
        <div className="music-bar__track-info">
          <div className={`music-bar__cover ${isPlaying ? "is-playing" : ""}`} style={track.cover ? { backgroundImage: `url(${track.cover})` } : undefined}><span>♪</span></div>
          {track.title || track.artist ? <div className={`music-bar__track-label ${track.artist ? "" : "is-single"}`}><strong>{track.title}</strong>{track.artist ? <><span className="music-bar__separator"> - </span><small>{track.artist}</small></> : null}</div> : null}
        </div>
        <div className="music-bar__center">
          <div className="music-bar__transport">
            <button type="button" aria-label="随机播放">⤨</button>
            <button type="button" aria-label="上一首" onClick={() => changeTrack(-1)} disabled={!musicTracks.length}>◀</button>
            <button className="music-bar__play" type="button" aria-label={isPlaying ? "暂停" : "播放"} onClick={togglePlayback} disabled={!track.src}>{isPlaying ? "Ⅱ" : "▶"}</button>
            <button type="button" aria-label="下一首" onClick={() => changeTrack(1)} disabled={!musicTracks.length}>▶</button>
            <button type="button" aria-label="显示歌单" aria-expanded={showPlaylist} onClick={() => { setShowPlaylist((visible) => !visible); setShowVolume(false); }}>☷</button>
          </div>
          <div className="music-bar__time"><span>{formatMusicTime(currentTime)}</span><span>{formatMusicTime(duration)}</span></div>
        </div>
        <div className="music-bar__actions">
          <button type="button" aria-label="显示音量" aria-expanded={showVolume} onClick={() => { setShowVolume((visible) => !visible); setShowPlaylist(false); }}>◖</button>
          <button type="button" aria-label="打开网易云歌单" onClick={() => window.open(netEasePlaylist.url, "_blank", "noopener,noreferrer")}>↗</button>
        </div>
        <audio ref={audioRef} src={track.src || undefined} preload="metadata" onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => changeTrack(1)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} />
      </article>
      {showVolume ? <div className="music-popover music-volume-popover"><span>音量</span><input aria-label="音量" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></div> : null}
      {showPlaylist ? <div className="music-popover music-playlist-popover"><div><strong>网易云歌单</strong><small>ID {netEasePlaylist.id}</small></div><a href={netEasePlaylist.url} target="_blank" rel="noreferrer">打开歌单 ↗</a><p>歌单界面已隐藏，接入歌曲数据后会在这里展开。</p></div> : null}
    </div>
  );
}

function HomeArticleCard({ article, onOpenArticle }: { article: ArticleSummary; onOpenArticle: (slug: string) => void }) {
  const [isHovered, setIsHovered] = useState(false);
  const [previewLines, setPreviewLines] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadPreview = async () => {
    if (previewLines.length || previewLoading) return;
    setPreviewLoading(true);
    try {
      const detail = await getPublishedArticle(article.slug);
      setPreviewLines(getArticlePreviewLines(detail.contentMarkdown));
    } catch {
      setPreviewLines(article.summary ? [article.summary] : []);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleHover = () => {
    setIsHovered(true);
    void loadPreview();
  };

  return (
    <button
      className={`glass-card article-list-card article-list-card--home ${article.coverUrl ? "has-cover" : ""} ${isHovered ? "is-hovered" : ""}`}
      type="button"
      onClick={() => onOpenArticle(article.slug)}
      onMouseEnter={handleHover}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={handleHover}
      onBlur={() => setIsHovered(false)}
      style={article.coverUrl ? { "--article-mask-rgb": articleMaskColors[article.slug] ?? "48 39 65", backgroundImage: `url("${article.coverUrl}")` } as React.CSSProperties : undefined}
    >
      {article.coverUrl ? (
        <>
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

  useEffect(() => {
    let cancelled = false;
    getPublishedArticles(0, 3)
      .then((result) => {
        if (!cancelled) setLatestArticles(result.content);
      })
      .catch(() => {
        // Keep the local sample posts when the Java API is not running.
      });

    return () => { cancelled = true; };
  }, []);

  const latestArticle = latestArticles[0] ?? fallbackArticleList[0];

  return (
    <>
      <div className="dashboard-grid">
        <article className="glass-card profile-card dashboard-card dashboard-card--profile">
          <div className="card-topline"><span>01 / Profile</span><span>•••</span></div>
          <div className="profile-main">
            <div className="avatar">YN</div>
            <div>
              <p className="card-kicker">Hello, I&apos;m</p>
              <h2>Your Name</h2>
              <p className="muted-copy">Designer, developer, and collector of small moments.</p>
            </div>
          </div>
          <div className="profile-bottom">
            <div className="status-line"><span className="status-dot" /> Available for good ideas</div>
            <button className="inline-button" onClick={() => onPageChange("about")} type="button">More about me ↗</button>
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
              <div className="small-card-heading"><p className="card-kicker">05 / 最新杂谈</p><button className="more-button" type="button">更多</button></div>
              <div className="chatter-bubble">最近在想：如果生活也有 changelog，会写些什么？</div>
              <span className="card-footer">A thought from today · 2h ago</span>
            </article>
            <article className="glass-card diary-card dashboard-card">
              <div className="small-card-heading"><p className="card-kicker">06 / 最新说说</p><button className="more-button" type="button">更多</button></div>
              <div className="diary-icon">✳</div>
              <h2>Went outside.</h2>
              <span className="card-footer">Small win · 2026.07.13</span>
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
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string[]>>({});
  const [previewLoadingSlug, setPreviewLoadingSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAllPublishedArticles()
      .then((result) => {
        if (!cancelled) {
          setArticles(result);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setArticles(fallbackArticleList);
          setStatus("fallback");
        }
      });

    return () => { cancelled = true; };
  }, []);

  const loadPreview = async (slug: string) => {
    if (Object.prototype.hasOwnProperty.call(previews, slug) || previewLoadingSlug === slug) return;
    setPreviewLoadingSlug(slug);
    try {
      let markdown = "";
      try {
        const article = await getPublishedArticle(slug);
        markdown = article.contentMarkdown;
      } catch {
        if (slug !== "first-note") throw new Error("preview request failed");
        const response = await fetch("/articles/first-note.md");
        if (!response.ok) throw new Error("preview fallback request failed");
        markdown = await response.text();
      }
      setPreviews((current) => ({ ...current, [slug]: getArticlePreviewLines(markdown) }));
    } catch {
      setPreviews((current) => ({ ...current, [slug]: [] }));
    } finally {
      setPreviewLoadingSlug(null);
    }
  };

  const handleArticleHover = (slug: string) => {
    setHoveredSlug(slug);
    void loadPreview(slug);
  };

  return (
    <div className="article-page article-list-page">
      <div className="article-list-stack">
        <div className="article-list-heading">
          <div>
            <p className="eyebrow"><span>04</span> / Article archive</p>
            <h1>All the things worth keeping.</h1>
          </div>
          <p>从数据库读取已发布的文章，选择一篇继续阅读。</p>
        </div>

        {status === "loading" ? <p className="article-state">正在读取文章列表…</p> : null}
        {status === "fallback" ? <p className="article-list-note">Java API 暂不可用，当前显示本地示例文章。</p> : null}
        {status !== "loading" ? (
          <div className="article-timeline" aria-label="文章列表">
            {articles.map((article) => {
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
                    onMouseLeave={() => setHoveredSlug(null)}
                    onFocus={() => handleArticleHover(article.slug)}
                    onBlur={() => setHoveredSlug(null)}
                    style={article.coverUrl ? { "--article-mask-rgb": articleMaskColors[article.slug] ?? "48 39 65", backgroundImage: `url("${article.coverUrl}")` } as React.CSSProperties : undefined}
                  >
                    {article.coverUrl ? (
                      <>
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

      if (slug !== "first-note") {
        if (!cancelled) setStatus("error");
        return;
      }

      try {
        const response = await fetch("/articles/first-note.md");
        if (!response.ok) throw new Error("article request failed");
        const markdown = await response.text();
        if (!cancelled) {
          setSource(markdown);
          setArticleTitle("First note");
          setCoverUrl("/article-covers/first-note.svg");
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
          style={coverUrl ? { backgroundImage: `url("${coverUrl}")` } : undefined}
        >
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

export default function Home() {
  const [activePage, setActivePage] = useState<PageKey>("home");
  const [selectedArticleSlug, setSelectedArticleSlug] = useState<string | null>(null);
  const now = useCurrentTime();

  return (
    <main className="site-shell">
      <div className="ambient ambient--one" aria-hidden="true" />
      <div className="ambient ambient--two" aria-hidden="true" />
      <div className="ambient ambient--three" aria-hidden="true" />
      <div className="cover-space" aria-label="顶部图片预留区域">
        <div className="cover-space__inner">
          <div className="cover-space__content shell">
            <span className="cover-space__label">01 / Cover image</span>
            <span className="cover-space__hint">Reserved space for your future image</span>
          </div>
        </div>
      </div>
      <header className="site-header">
        <div className="site-header__inner shell">
        <div className="brand"><span className="brand-mark">✦</span><span>YOUR <i>/</i> SPACE</span></div>
        <div className="search-pill"><span>⌕</span><span>Search this space...</span><kbd>⌘ K</kbd></div>
        <nav className="page-nav" aria-label="页面切换">
          {navigation.map((item) => <PageButton key={item.id} active={activePage === item.id} index={item.index} label={item.label} onClick={() => { setActivePage(item.id); setSelectedArticleSlug(null); }} />)}
        </nav>
        <AuthControls />
        </div>
      </header>

      {activePage !== "article" ? <ClockDisplay now={now} /> : null}

      <div className="workspace-shell shell">
        {activePage === "home" && <HomePage onPageChange={setActivePage} onOpenArticle={(slug) => { setSelectedArticleSlug(slug); setActivePage("article"); }} now={now} />}
        {activePage === "projects" && <ProjectsPage />}
        {activePage === "about" && <AboutPage />}
        {activePage === "article" && (selectedArticleSlug
          ? <ArticleDetailPage key={selectedArticleSlug} slug={selectedArticleSlug} onBack={() => setSelectedArticleSlug(null)} />
          : <ArticleListPage onOpenArticle={setSelectedArticleSlug} />)}
      </div>

      {activePage !== "article" ? <footer className="site-footer shell"><span>© 2026 Your Name</span><span>Made with patience &amp; curiosity.</span><span>v.01</span></footer> : null}
    </main>
  );
}

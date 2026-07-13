"use client";

import { useEffect, useState } from "react";

type PageKey = "home" | "projects" | "about";

const navigation: { id: PageKey; label: string; index: string }[] = [
  { id: "home", label: "Home", index: "01" },
  { id: "projects", label: "Projects", index: "02" },
  { id: "about", label: "About", index: "03" },
];

const projects = [
  { title: "Luma Notes", type: "Product / 2026", description: "A quiet place for ideas, fragments, and the things worth keeping.", color: "lilac" },
  { title: "Orbit / 01", type: "Experiment / 2025", description: "A small interactive study of light, distance, and moving slowly.", color: "mint" },
  { title: "Slow Internet", type: "Editorial / 2025", description: "Notes on attention, digital gardens, and making room for thought.", color: "peach" },
];

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

  return { lunar, event };
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
          location = address?.city ?? address?.town ?? address?.county ?? address?.state ?? location;
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
              {day ? <><b>{day}</b><small>{detail?.event ?? detail?.lunar ?? ""}</small></> : null}
            </span>
          );
        })}
      </div>
      <div className="calendar-card__footer"><span>Today&apos;s page</span><span>{reference.getFullYear()}</span></div>
    </article>
  );
}

function WeatherCard() {
  const { weather, status } = useLocalWeather();
  const summary = weather ? getWeatherSummary(weather.code) : { label: "天气", icon: "◌" };
  const statusCopy = status === "loading"
    ? "正在请求位置授权…"
    : status === "denied"
      ? "允许定位后显示当地天气"
      : status === "unsupported"
        ? "当前浏览器不支持定位"
        : "天气服务暂时不可用";

  return (
    <article className="glass-card weather-card dashboard-card">
      <div className="card-heading">
        <div>
          <p className="card-kicker">02 / Local weather</p>
          <h2>{weather?.location ?? "你所在的地方"}</h2>
        </div>
        <span className="weather-icon" aria-hidden="true">{summary.icon}</span>
      </div>
      {weather ? (
        <>
          <div className="weather-main">
            <strong>{Math.round(weather.temperature)}°</strong>
            <div><span>{summary.label}</span><small>体感 {Math.round(weather.apparentTemperature)}°</small></div>
          </div>
          <div className="weather-meta"><span>湿度 {weather.humidity}%</span><span>风速 {Math.round(weather.windSpeed)} km/h</span></div>
        </>
      ) : (
        <div className="weather-placeholder"><span className="status-dot" />{statusCopy}</div>
      )}
    </article>
  );
}

function PhotoWallGraphic() {
  return (
    <div className="photo-wall" aria-hidden="true">
      <div className="photo-tile photo-tile--one"><span>01</span></div>
      <div className="photo-tile photo-tile--two"><span>02</span></div>
      <div className="photo-tile photo-tile--three"><span>03</span></div>
      <div className="photo-tile photo-tile--four"><span>04</span></div>
    </div>
  );
}

function HomePage({ onPageChange, now }: { onPageChange: (page: PageKey) => void; now: Date | null }) {
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

        <CalendarCard now={now} />

        <WeatherCard />

        <article className="glass-card quote-card dashboard-card">
          <span className="quote-mark">“</span>
          <p>Make it simple, but significant.</p>
          <span className="quote-author">— Don Draper</span>
        </article>

        <article className="glass-card photo-card dashboard-card">
          <div className="card-heading"><div><p className="card-kicker">03 / Photo wall</p><h2>Recent frames</h2></div><span className="round-arrow">↗</span></div>
          <PhotoWallGraphic />
          <div className="card-footer"><span>Four fragments from an ordinary week</span><span>View 24</span></div>
        </article>

        <div className="feed-column">
          <article className="glass-card posts-card dashboard-card">
            <div className="card-heading"><div><p className="card-kicker">04 / Notes</p><h2>Latest thoughts</h2></div><span className="round-arrow">→</span></div>
            <div className="post-list">
              <div className="post-item"><span>07.13</span><strong>把网站留一点呼吸感</strong><em>↗</em></div>
              <div className="post-item"><span>06.28</span><strong>重新理解“完成”这件事</strong><em>↗</em></div>
              <div className="post-item"><span>06.10</span><strong>三种保持好奇的练习</strong><em>↗</em></div>
            </div>
          </article>

          <div className="dashboard-split">
            <article className="glass-card chatter-card dashboard-card">
              <p className="card-kicker">05 / Chatter</p>
              <div className="chatter-bubble">最近在想：如果生活也有 changelog，会写些什么？</div>
              <span className="card-footer">A thought from today · 2h ago</span>
            </article>
            <article className="glass-card diary-card dashboard-card">
              <p className="card-kicker">06 / Tiny diary</p>
              <div className="diary-icon">✳</div>
              <h2>Went outside.</h2>
              <span className="card-footer">Small win · 2026.07.13</span>
            </article>
          </div>
        </div>

        <article className="glass-card stats-card dashboard-card">
          <div className="card-heading"><div><p className="card-kicker">07 / Site dashboard</p><h2>A few numbers, just for fun.</h2></div><span className="dashboard-badge">LIVE-ISH</span></div>
          <div className="stat-list">
            <div><strong>12</strong><span>Projects</span></div>
            <div><strong>48</strong><span>Notes</span></div>
            <div><strong>2.4k</strong><span>Little visits</span></div>
            <div><strong>∞</strong><span>Ideas left</span></div>
          </div>
        </article>
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

export default function Home() {
  const [activePage, setActivePage] = useState<PageKey>("home");
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
          {navigation.map((item) => <PageButton key={item.id} active={activePage === item.id} index={item.index} label={item.label} onClick={() => setActivePage(item.id)} />)}
        </nav>
        <div className="header-status"><span className="status-dot" /> <span>Online-ish</span></div>
        </div>
      </header>

      <ClockDisplay now={now} />

      <div className="workspace-shell shell">
        {activePage === "home" && <HomePage onPageChange={setActivePage} now={now} />}
        {activePage === "projects" && <ProjectsPage />}
        {activePage === "about" && <AboutPage />}
      </div>

      <footer className="site-footer shell"><span>© 2026 Your Name</span><span>Made with patience &amp; curiosity.</span><span>v.01</span></footer>
    </main>
  );
}

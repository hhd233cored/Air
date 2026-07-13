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

const calendarDetails: Record<string, { lunar: string; event?: string }> = {
  "2026-7-1": { lunar: "五月十七", event: "建党节" },
  "2026-7-2": { lunar: "五月十八" },
  "2026-7-3": { lunar: "五月十九" },
  "2026-7-4": { lunar: "五月二十" },
  "2026-7-5": { lunar: "五月廿一" },
  "2026-7-6": { lunar: "五月廿二" },
  "2026-7-7": { lunar: "五月廿三", event: "小暑" },
  "2026-7-8": { lunar: "五月廿四" },
  "2026-7-9": { lunar: "五月廿五" },
  "2026-7-10": { lunar: "五月廿六" },
  "2026-7-11": { lunar: "五月廿七" },
  "2026-7-12": { lunar: "五月廿八" },
  "2026-7-13": { lunar: "五月廿九" },
  "2026-7-14": { lunar: "六月初一" },
  "2026-7-15": { lunar: "六月初二" },
  "2026-7-16": { lunar: "六月初三" },
  "2026-7-17": { lunar: "六月初四" },
  "2026-7-18": { lunar: "六月初五" },
  "2026-7-19": { lunar: "六月初六" },
  "2026-7-20": { lunar: "六月初七" },
  "2026-7-21": { lunar: "六月初八" },
  "2026-7-22": { lunar: "六月初九" },
  "2026-7-23": { lunar: "六月初十", event: "大暑" },
  "2026-7-24": { lunar: "六月十一" },
  "2026-7-25": { lunar: "六月十二" },
  "2026-7-26": { lunar: "六月十三" },
  "2026-7-27": { lunar: "六月十四" },
  "2026-7-28": { lunar: "六月十五" },
  "2026-7-29": { lunar: "六月十六" },
  "2026-7-30": { lunar: "六月十七" },
  "2026-7-31": { lunar: "六月十八" },
};

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
  const time = now
    ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now)
    : "--:--";
  const date = now
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now)
    : "正在读取日期";

  return (
    <section className="clock-display" aria-label="当前时间">
      <div className="clock-display__time">{time}</div>
      <div className="clock-display__date">{date}</div>
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
  const reference = now ?? new Date(2026, 6, 13);
  const year = reference.getFullYear();
  const monthIndex = reference.getMonth();
  const month = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(reference);
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cellCount = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  const calendarDays = Array.from({ length: cellCount }, (_, index) => {
    const day = index - firstDay + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const events = calendarDays
    .filter((day): day is number => day !== null)
    .map((day) => ({ day, event: calendarDetails[`${year}-${monthIndex + 1}-${day}`]?.event }))
    .filter((item): item is { day: number; event: string } => Boolean(item.event));

  return (
    <article className="glass-card calendar-card dashboard-card">
      <div className="calendar-card__month"><span>{month}</span><small>Monthly view</small></div>
      <div className="calendar-grid">
        {weekdays.map((weekday) => <span className="calendar-weekday" key={weekday}>{weekday}</span>)}
        {calendarDays.map((day, index) => {
          const detail = day ? calendarDetails[`${year}-${monthIndex + 1}-${day}`] : undefined;
          return (
            <span className={`calendar-day ${day === reference.getDate() ? "is-today" : ""} ${detail?.event ? "has-event" : ""}`} key={`${day ?? "empty"}-${index}`} title={detail?.event}>
              {day ? <><b>{day}</b><small>{detail?.lunar ?? ""}</small></> : null}
            </span>
          );
        })}
      </div>
      <div className="calendar-highlights">
        {events.map(({ day, event }) => <span key={event}><b>{day}日</b> {event}</span>)}
      </div>
      <div className="calendar-card__footer"><span>Today&apos;s page</span><span>{reference.getFullYear()}</span></div>
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

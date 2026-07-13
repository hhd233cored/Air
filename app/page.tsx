"use client";

import { useState } from "react";

type Project = {
  title: string;
  category: string;
  year: string;
  description: string;
  tags: string[];
  tone: "lilac" | "mint" | "peach";
  metric: string;
};

const projects: Project[] = [
  {
    title: "Luma Notes",
    category: "Product / 01",
    year: "2026",
    description: "一个把灵感、阅读和日常观察放在同一张桌面上的轻量空间。",
    tags: ["Design", "Product"],
    tone: "lilac",
    metric: "A softer way to collect ideas",
  },
  {
    title: "Orbit / 01",
    category: "Experiment / 02",
    year: "2025",
    description: "用 WebGL 和时间轴做的一次关于轨道、光线与耐心的交互实验。",
    tags: ["Code", "Motion"],
    tone: "mint",
    metric: "Move slowly, notice more",
  },
  {
    title: "Slow Internet",
    category: "Editorial / 03",
    year: "2025",
    description: "一份关于慢阅读、数字花园和不被通知牵着走的周刊。",
    tags: ["Writing", "Culture"],
    tone: "peach",
    metric: "A small archive of attention",
  },
];

const filters = ["All", "Design", "Code", "Writing"];

const notes = [
  {
    date: "07.13.26",
    title: "关于把网站留一点呼吸感",
    type: "Notes",
  },
  {
    date: "06.28.26",
    title: "最近在重新理解“完成”这件事",
    type: "Journal",
  },
  {
    date: "06.10.26",
    title: "三种让我保持好奇的练习",
    type: "Field notes",
  },
];

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function ProjectArtwork({ tone }: { tone: Project["tone"] }) {
  return (
    <div className={`project-art project-art--${tone}`} aria-hidden="true">
      <div className="art-grid" />
      <div className="art-orbit art-orbit--one" />
      <div className="art-orbit art-orbit--two" />
      <div className="art-core" />
      <div className="art-label">ARCHIVE / 00{tone === "lilac" ? "1" : tone === "mint" ? "2" : "3"}</div>
    </div>
  );
}

export default function Home() {
  const [activeFilter, setActiveFilter] = useState("All");
  const visibleProjects = projects.filter(
    (project) => activeFilter === "All" || project.tags.includes(activeFilter),
  );

  return (
    <main className="site-shell" id="top">
      <div className="ambient ambient--violet" aria-hidden="true" />
      <div className="ambient ambient--cyan" aria-hidden="true" />
      <div className="ambient ambient--peach" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <header className="site-header shell">
        <a className="brand" href="#top" aria-label="回到首页">
          <span className="brand-mark">✦</span>
          <span>
            YOUR <i>/</i> SPACE
          </span>
        </a>

        <nav className="site-nav" aria-label="主导航">
          <a href="#work">Work</a>
          <a href="#about">About</a>
          <a href="#notes">Notes</a>
        </nav>

        <a className="button button--small button--ghost" href="#contact">
          Let&apos;s talk <Arrow />
        </a>
      </header>

      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="status-dot" />
            Personal space / 2026
          </div>
          <h1>
            把好奇心，做成
            <br />
            <em>可以被访问的东西。</em>
          </h1>
          <p className="hero-intro">
            你好，我是 <strong>Your Name</strong>。我在设计、代码和生活之间来回游荡，
            <br className="desktop-break" />
            记录正在发生的事，也把一些想法做成小小的作品。
          </p>
          <div className="hero-actions">
            <a className="button button--primary" href="#work">
              看看我做过的事 <Arrow />
            </a>
            <a className="text-link" href="#about">
              了解我 <span aria-hidden="true">↓</span>
            </a>
          </div>
          <div className="hero-meta">
            <span>Based in Shanghai</span>
            <span className="meta-divider" />
            <span>Open to good ideas</span>
          </div>
        </div>

        <div className="hero-visual" aria-label="个人资料卡片">
          <div className="glass-card profile-card">
            <div className="profile-card__top">
              <span className="card-index">01 — Profile</span>
              <span className="card-menu" aria-hidden="true">
                •••
              </span>
            </div>
            <div className="profile-orb">
              <span className="orb-ring orb-ring--one" />
              <span className="orb-ring orb-ring--two" />
              <span className="orb-glow" />
              <span className="orb-letter">Y</span>
            </div>
            <div className="profile-card__bottom">
              <div>
                <p className="card-label">Current mood</p>
                <p className="profile-mood">curious, as always <span>↗</span></p>
              </div>
              <div className="profile-status">
                <span className="status-dot" />
                <span>Online-ish</span>
              </div>
            </div>
          </div>

          <div className="glass-card mini-card mini-card--top">
            <span className="mini-icon">⌁</span>
            <span>Currently building<br /><strong>something gentle</strong></span>
          </div>
          <div className="glass-card mini-card mini-card--bottom">
            <span className="mini-card__number">12</span>
            <span>projects<br />in the archive</span>
          </div>
        </div>
      </section>

      <section className="section shell" id="work">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Selected work</p>
            <h2>一些被认真对待的尝试</h2>
          </div>
          <p className="section-note">/ 01 — 03</p>
        </div>

        <div className="filter-row" role="tablist" aria-label="项目筛选">
          {filters.map((filter) => (
            <button
              className={`filter-button ${activeFilter === filter ? "is-active" : ""}`}
              key={filter}
              onClick={() => setActiveFilter(filter)}
              role="tab"
              aria-selected={activeFilter === filter}
              type="button"
            >
              {filter}
            </button>
          ))}
        </div>

        <div className="project-grid">
          {visibleProjects.map((project, index) => (
            <article className="glass-card project-card" key={project.title}>
              <ProjectArtwork tone={project.tone} />
              <div className="project-card__body">
                <div className="project-card__meta">
                  <span>{project.category}</span>
                  <span>{project.year}</span>
                </div>
                <h3>{project.title}</h3>
                <p>{project.description}</p>
                <div className="project-card__footer">
                  <div className="tag-list">
                    {project.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                  </div>
                  <a className="round-link" href="#contact" aria-label={`了解 ${project.title}`}>
                    <Arrow />
                  </a>
                </div>
              </div>
              <span className="project-number">0{index + 1}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell about-section" id="about">
        <div className="section-heading">
          <div>
            <p className="section-kicker">A little context</p>
            <h2>不止是作品集，<br />也是一份正在更新的自我介绍。</h2>
          </div>
          <p className="section-note">/ 02 — 03</p>
        </div>

        <div className="about-grid">
          <article className="glass-card about-card about-card--wide">
            <p className="card-label">A note from me</p>
            <p className="about-statement">
              我喜欢把复杂的东西变简单，把模糊的感受变成清晰的形状。对我来说，好的设计像一扇门：不抢你的注意力，但会让你愿意多走一步。
            </p>
            <div className="about-signature">YN <span>✳</span></div>
          </article>
          <article className="glass-card about-card">
            <p className="card-label">Toolkit</p>
            <div className="toolkit-list">
              <span>Figma</span><span>React</span><span>TypeScript</span><span>Writing</span><span>摄影</span><span>散步</span>
            </div>
            <div className="card-bottom-line"><span>Always learning</span><span>∞</span></div>
          </article>
          <article className="glass-card about-card now-card">
            <div className="now-card__heading"><p className="card-label">Now / July</p><span className="pulse-ring" /></div>
            <p>在做一个更慢、更有触感的个人知识库。</p>
            <div className="now-progress"><span /></div>
            <div className="card-bottom-line"><span>Reading Ursula K. Le Guin</span><span>↗</span></div>
          </article>
        </div>
      </section>

      <section className="section shell notes-section" id="notes">
        <div className="section-heading">
          <div>
            <p className="section-kicker">From the notebook</p>
            <h2>偶尔写点什么</h2>
          </div>
          <a className="text-link" href="#contact">View all <Arrow /></a>
        </div>
        <div className="notes-list">
          {notes.map((note) => (
            <a className="glass-card note-row" href="#contact" key={note.title}>
              <span className="note-date">{note.date}</span>
              <span className="note-title">{note.title}</span>
              <span className="note-type">{note.type}</span>
              <span className="note-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>

      <footer className="footer shell" id="contact">
        <div className="footer-card glass-card">
          <div>
            <p className="section-kicker">Have a good feeling?</p>
            <h2>那就从一句<br /><em>你好</em>开始。</h2>
          </div>
          <div className="footer-contact">
            <a className="button button--primary" href="mailto:hello@example.com">hello@example.com <Arrow /></a>
            <p>© 2026 Your Name<br />Made with patience &amp; curiosity.</p>
          </div>
        </div>
        <div className="footer-bottom"><span>YOUR / SPACE</span><a href="#top">Back to top ↑</a><span>v.01</span></div>
      </footer>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthPanel } from "../components/AuthPanel";
import { ArticleDetailView } from "../components/ArticleDetailView";
import { MaintenancePage } from "../components/MaintenancePage";
import { resolveApiUrl } from "../lib/api/client";
import { getCurrentUser, type AuthUser } from "../lib/api/auth";

export default function ArticlePage() {
  const [slug, setSlug] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authPanelOpen, setAuthPanelOpen] = useState(false);

  useEffect(() => {
    const slugTimer = window.setTimeout(() => {
      const querySlug = new URLSearchParams(window.location.search).get("slug")?.trim();
      setSlug(querySlug || "");
    }, 0);

    getCurrentUser()
      .then((response) => setAuthUser(response.user))
      .catch(() => setAuthUser(null));

    return () => window.clearTimeout(slugTimer);
  }, []);

  if (process.env.NEXT_PUBLIC_MAINTENANCE_MODE !== "false") return <MaintenancePage />;

  const goHome = () => window.location.assign("/");

  return (
    <main className="site-shell">
      <div className="ambient ambient--one" aria-hidden="true" />
      <div className="ambient ambient--two" aria-hidden="true" />
      <div className="ambient ambient--three" aria-hidden="true" />
      <header className="site-header">
        <div className="site-header__inner shell">
          <Link className="brand" href="/" aria-label="返回主页">AirChord <i>/</i> StrIn 的小站</Link>
          <div aria-hidden="true" />
          <div className="header-status">
            <button
              className={`header-auth-button${authUser ? " is-authenticated" : ""}`}
              type="button"
              aria-label={authUser ? `${authUser.username} 账户` : "登录"}
              title={authUser ? `${authUser.username} · ${authUser.role}` : "登录"}
              aria-expanded={authPanelOpen}
              onClick={() => setAuthPanelOpen((open) => !open)}
            >
              {authUser?.avatarUrl ? <img src={resolveApiUrl(authUser.avatarUrl)} alt="" /> : null}
            </button>
            {authUser ? <span className="header-auth-label"><strong>{authUser.username}</strong><small>{authUser.role}</small></span> : null}
            {authPanelOpen ? <AuthPanel user={authUser} onUserChange={setAuthUser} onClose={() => setAuthPanelOpen(false)} onOpenAdmin={() => { setAuthPanelOpen(false); window.open("/admin/", "_blank", "noopener,noreferrer"); }} onOpenMusic={() => { setAuthPanelOpen(false); window.open("/admin/music/", "_blank", "noopener,noreferrer"); }} onOpenEditor={() => { setAuthPanelOpen(false); window.open("/editor/", "_blank", "noopener,noreferrer"); }} /> : null}
          </div>
        </div>
      </header>

      <div className="content-backdrop content-backdrop--article-detail">
        <div className="content-backdrop__detail-background" aria-hidden="true" />
        <div className="workspace-shell shell">
          {slug ? (
            <ArticleDetailView
              slug={slug}
              onBack={goHome}
              currentUser={authUser}
              onRequestLogin={() => setAuthPanelOpen(true)}
            />
          ) : (
            <div className="article-page">
              <article className="glass-card article-card standalone-article-empty">
                <p className="article-state">正在准备文章地址…</p>
              </article>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

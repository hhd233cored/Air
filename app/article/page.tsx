"use client";

import { useEffect, useState } from "react";
import { ArticleDetailView } from "../components/ArticleDetailView";
import { CoverCarousel, SiteHeader, type SitePageKey } from "../components/SiteChrome";
import { MaintenancePage } from "../components/MaintenancePage";
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

  useEffect(() => {
    let timer: number | undefined;
    const applyNavigationScroll = () => {
      const cover = document.querySelector<HTMLElement>(".cover-space");
      const targetTop = cover?.offsetHeight ?? 0;
      window.scrollTo(0, targetTop);
      document.documentElement.scrollTop = targetTop;
      document.body.scrollTop = targetTop;
    };

    const frame = window.requestAnimationFrame(() => {
      applyNavigationScroll();
      timer = window.setTimeout(applyNavigationScroll, 80);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  if (process.env.NEXT_PUBLIC_MAINTENANCE_MODE !== "false") return <MaintenancePage />;

  const goHome = () => window.location.assign("/");
  const navigateFromArticle = (page: SitePageKey) => {
    if (page === "home") {
      goHome();
      return;
    }
    if (page === "article") return;
    window.location.assign(`/?page=${encodeURIComponent(page)}`);
  };

  return (
    <main className="site-shell">
      <div className="ambient ambient--one" aria-hidden="true" />
      <div className="ambient ambient--two" aria-hidden="true" />
      <div className="ambient ambient--three" aria-hidden="true" />
      <CoverCarousel />
      <SiteHeader
        activePage="article"
        onBrandClick={goHome}
        onNavigate={navigateFromArticle}
        authUser={authUser}
        authPanelOpen={authPanelOpen}
        onToggleAuth={() => setAuthPanelOpen((open) => !open)}
        onUserChange={setAuthUser}
        onCloseAuth={() => setAuthPanelOpen(false)}
      />

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

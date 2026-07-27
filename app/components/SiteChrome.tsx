"use client";

import { useEffect, useState } from "react";
import type { AuthUser } from "../lib/api/auth";
import { resolveApiUrl } from "../lib/api/client";
import { AuthPanel } from "./AuthPanel";

export type SitePageKey = "home" | "projects" | "article" | "chatter" | "guestbook";

export const siteNavigation: { id: SitePageKey; label: string; index: string }[] = [
  { id: "home", label: "Home", index: "01" },
  { id: "article", label: "Article", index: "02" },
  { id: "chatter", label: "Dairy", index: "03" },
  { id: "guestbook", label: "Guestbook", index: "04" },
];

const coverImages = ["1.png", "2.jpg", "3.png", "4.png", "5.jpg", "6.png", "7.jpg", "8.png", "9.jpg"]
  .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));

export function PageButton({ active, index, label, onClick }: { active: boolean; index: string; label: string; onClick: () => void }) {
  return (
    <button className={`page-button ${active ? "is-active" : ""}`} onClick={onClick} type="button" aria-current={active ? "page" : undefined}>
      <span>{index}</span>
      {label}
    </button>
  );
}

export function CoverCarousel() {
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

type SiteHeaderProps = {
  activePage: SitePageKey;
  onBrandClick: () => void;
  onNavigate: (page: SitePageKey) => void;
  authUser: AuthUser | null;
  authPanelOpen: boolean;
  onToggleAuth: () => void;
  onUserChange: (user: AuthUser | null) => void;
  onCloseAuth: () => void;
};

export function SiteHeader({ activePage, onBrandClick, onNavigate, authUser, authPanelOpen, onToggleAuth, onUserChange, onCloseAuth }: SiteHeaderProps) {
  const openManagementPage = (path: string) => {
    onCloseAuth();
    window.open(path, "_blank", "noopener,noreferrer");
  };

  return (
    <header className="site-header">
      <div className="site-header__inner shell">
        <button className="brand brand-button" type="button" aria-label="返回主页" onClick={onBrandClick}><span>AirChord <i>/</i> StrInの小站</span></button>
        <nav className="page-nav" aria-label="页面切换">
          {siteNavigation.map((item) => <PageButton key={item.id} active={activePage === item.id} index={item.index} label={item.label} onClick={() => onNavigate(item.id)} />)}
        </nav>
        <div className="header-status">
          <button
            className={`header-auth-button${authUser ? " is-authenticated" : ""}`}
            type="button"
            aria-label={authUser ? `${authUser.username}账户` : "登录"}
            title={authUser ? `${authUser.username} · ${authUser.role}` : "登录"}
            aria-expanded={authPanelOpen}
            onClick={onToggleAuth}
          >
            {authUser?.avatarUrl ? <img src={resolveApiUrl(authUser.avatarUrl)} alt="" /> : authUser ? <span className="header-auth-button__empty" aria-hidden="true" /> : null}
          </button>
          {authUser ? <span className="header-auth-label"><strong>{authUser.username}</strong><small>{authUser.role}</small></span> : null}
          {authPanelOpen ? (
            <AuthPanel
              user={authUser}
              onUserChange={onUserChange}
              onClose={onCloseAuth}
              onOpenAdmin={() => openManagementPage("/admin/")}
              onOpenMusic={() => openManagementPage("/admin/music/")}
              onOpenEditor={() => openManagementPage("/editor/")}
            />
          ) : null}
          <button className="header-user-button" type="button" aria-label="用户账户" title="用户账户" />
        </div>
      </div>
    </header>
  );
}

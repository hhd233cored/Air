"use client";

import { useEffect, useState } from "react";
import { resolveApiUrl } from "../lib/api/client";
import { getLocalArticleDetail, getPublishedArticle, usesDatabaseContent as usesDatabaseArticleContent } from "../lib/api/articles";
import type { AuthUser } from "../lib/api/auth";
import { CommentsPanel } from "./CommentsPanel";
import { MarkdownRenderer } from "./MarkdownRenderer";

function formatArticleCreatedAt(value: string | null) {
  if (!value) return { date: "----.--.--", time: "--:--" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "----.--.--", time: "--:--" };
  return {
    date: `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`,
    time: new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date),
  };
}

type ArticleDetailViewProps = {
  slug: string;
  onBack: () => void;
  currentUser: AuthUser | null;
  onRequestLogin: () => void;
};

export function ArticleDetailView({ slug, onBack, currentUser, onRequestLogin }: ArticleDetailViewProps) {
  const [source, setSource] = useState("");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [articleDate, setArticleDate] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;

    const loadArticle = async () => {
      try {
        const article = await getPublishedArticle(slug);
        if (!cancelled) {
          setSource(article.contentMarkdown);
          setCoverUrl(article.coverUrl);
          setArticleDate(article.publishedAt ?? article.createdAt);
          setStatus("ready");
        }
        return;
      } catch {
        // Fall back to the bundled Markdown demo while the API is offline.
      }

      if (usesDatabaseArticleContent) {
        if (!cancelled) setStatus("error");
        return;
      }

      try {
        const localArticle = await getLocalArticleDetail(slug);
        if (!cancelled) {
          setSource(localArticle.contentMarkdown);
          setCoverUrl(localArticle.coverUrl);
          setArticleDate(localArticle.publishedAt ?? localArticle.createdAt);
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
        <div className={`article-cover-space ${coverUrl ? "has-image" : ""}`} aria-label="文章封面">
          <button className="article-cover-back-button" type="button" aria-label="返回文章列表" onClick={onBack}>←</button>
          {coverUrl ? <img className="article-cover-space__image" src={resolveApiUrl(coverUrl)} alt="" loading="eager" decoding="async" /> : null}
        </div>
        <div className="article-seam-avatar" aria-hidden="true">
          <img src="/picture/portrait.png" alt="" loading="lazy" decoding="async" />
        </div>
        <article className="glass-card article-card">
          {articleDate ? (() => {
            const formattedDate = formatArticleCreatedAt(articleDate);
            return <time className="article-detail-date" dateTime={articleDate}>{formattedDate.date} {formattedDate.time}</time>;
          })() : null}
          {status === "loading" ? <p className="article-state">正在读取 Markdown…</p> : null}
          {status === "error" ? <p className="article-state">暂时无法读取文章内容，请检查 API 或 Markdown 文件。</p> : null}
          {status === "ready" ? <MarkdownRenderer source={source} /> : null}
          {status === "ready" ? (
            <CommentsPanel
              targetType="ARTICLE"
              targetSlug={slug}
              currentUser={currentUser}
              onRequestLogin={onRequestLogin}
              defaultOpen
            />
          ) : null}
        </article>
      </div>
    </div>
  );
}

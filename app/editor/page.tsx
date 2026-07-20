"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { NotFoundPage } from "../components/NotFoundPage";
import { ChatterEditor } from "./ChatterEditor";
import { CoverCropper } from "./CoverCropper";
import { ApiRequestError, resolveApiUrl } from "../lib/api/client";
import { deleteEditorArticle, getEditorArticle, getEditorArticles, getEditorCurrentUser, saveEditorArticle, type EditorArticleInput } from "../lib/api/editor";
import type { ArticleSummary } from "../lib/api/articles";

const editorEnabled = process.env.NEXT_PUBLIC_EDITOR_ENABLED === "true";

function toLocalDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function toIsoDateTime(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function slugifyTitle(value: string) {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || `article-${Date.now()}`;
}

function safeAssetName(value: string) {
  return value.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^\.+/, "") || "image.png";
}

function emptyForm(): EditorArticleInput {
  return { title: "", slug: "", summary: "", tags: "", status: "DRAFT", publishedAt: "", contentMarkdown: "", cover: null, assets: [] };
}

function errorMessage(error: unknown) {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : "编辑器请求失败";
}

export default function EditorPage() {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [form, setForm] = useState<EditorArticleInput>(emptyForm);
  const [editingSlug, setEditingSlug] = useState<string | undefined>();
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [loading, setLoading] = useState(editorEnabled);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editorMode, setEditorMode] = useState<"articles" | "chatter">("articles");
  const [authStatus, setAuthStatus] = useState<"checking" | "allowed" | "denied">(editorEnabled ? "checking" : "allowed");
  const coverObjectUrl = useRef<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverToCrop, setCoverToCrop] = useState<File | null>(null);
  const previewSource = useMemo(() => form.contentMarkdown || "在左侧输入 Markdown，右侧会实时显示预览。", [form.contentMarkdown]);

  useEffect(() => {
    if (!editorEnabled) return;
    let active = true;
    getEditorCurrentUser()
      .then(({ user }) => {
        if (user.role !== "ADMIN") throw new Error("Editor access denied");
        if (active) setAuthStatus("allowed");
      })
      .catch(() => {
        if (active) setAuthStatus("denied");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!editorEnabled || authStatus !== "allowed") return;
    let active = true;
    getEditorArticles().then((response) => { if (active) setArticles(response.content); }).catch((reason) => { if (active) setError(errorMessage(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authStatus]);

  useEffect(() => () => { if (coverObjectUrl.current) URL.revokeObjectURL(coverObjectUrl.current); }, []);

  const update = <K extends keyof EditorArticleInput>(key: K, value: EditorArticleInput[K]) => setForm((previous) => ({ ...previous, [key]: value }));
  const startNew = () => { setEditingSlug(undefined); setForm(emptyForm()); setSlugTouched(false); setCoverPreview(null); setCoverToCrop(null); if (coverInputRef.current) coverInputRef.current.value = ""; setMessage(""); setError(""); };

  const selectArticle = async (slug: string) => {
    setLoading(true); setError("");
    try {
      const article = await getEditorArticle(slug);
      setEditingSlug(article.slug);
      setForm({ title: article.title, slug: article.slug, summary: article.summary ?? "", tags: article.tags.join(", "), status: article.status, publishedAt: toLocalDateTime(article.publishedAt), contentMarkdown: article.contentMarkdown, cover: null, assets: [] });
      setSlugTouched(true); setCoverPreview(article.coverUrl); setCoverToCrop(null); if (coverInputRef.current) coverInputRef.current.value = ""; setMessage("");
    } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); }
  };

  const onTitleChange = (title: string) => { update("title", title); if (!slugTouched) update("slug", slugifyTitle(title)); };
  const onCoverChange = (file: File | undefined) => { if (!file) return; setCoverToCrop(file); setError(""); };
  const applyCoverCrop = (file: File) => { if (coverObjectUrl.current) URL.revokeObjectURL(coverObjectUrl.current); coverObjectUrl.current = URL.createObjectURL(file); update("cover", file); setCoverPreview(coverObjectUrl.current); setCoverToCrop(null); };
  const onAssetsChange = (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    update("assets", [...(form.assets ?? []), ...selected]);
    const slug = form.slug || slugifyTitle(form.title);
    const markdown = selected.map((file) => { const name = safeAssetName(file.name); return `![${name}](/articles/${slug}/assets/${name})`; }).join("\n\n");
    update("contentMarkdown", `${form.contentMarkdown.trimEnd()}\n\n${markdown}\n`);
  };

  const save = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      if (!form.title.trim()) throw new Error("请填写标题");
      if (!form.slug.trim()) throw new Error("请填写 Slug");
      if (!editingSlug && !form.cover) throw new Error("新文章必须选择封面图");
      const saved = await saveEditorArticle({ ...form, publishedAt: toIsoDateTime(form.publishedAt) }, editingSlug);
      setEditingSlug(saved.slug); setForm((previous) => ({ ...previous, slug: saved.slug, cover: null, assets: [], publishedAt: toLocalDateTime(saved.publishedAt) })); setCoverToCrop(null); setCoverPreview(saved.coverUrl);
      const list = await getEditorArticles(); setArticles(list.content); setMessage("文章已保存到 public/articles");
    } catch (reason) { setError(errorMessage(reason)); } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!editingSlug) return;
    if (!window.confirm(`确定删除文章“${form.title || editingSlug}”吗？此操作不可撤销。`)) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await deleteEditorArticle(editingSlug);
      const list = await getEditorArticles();
      setArticles(list.content);
      startNew();
      setMessage("文章已删除");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  if (!editorEnabled) return <main className="editor-page"><section className="editor-disabled glass-card"><p className="card-kicker">LOCAL EDITOR</p><h1>编辑器未启用</h1><p>请在本地 .env 设置 NEXT_PUBLIC_EDITOR_ENABLED=true，然后重新启动前端。</p></section></main>;
  if (authStatus === "denied") return <NotFoundPage />;
  if (authStatus === "checking") return <main className="editor-page"><section className="editor-disabled glass-card">正在检查登录状态…</section></main>;

  if (editorMode === "chatter") return <ChatterEditor onBack={() => setEditorMode("articles")} />;

  return (
    <main className="editor-page">
      <header className="editor-header"><div><p className="card-kicker">LOCAL ARTICLE EDITOR</p><h1>文章编辑器</h1></div><div className="editor-header__actions"><Link className="editor-link" href="/">返回首页</Link><button className="editor-link" type="button" onClick={() => setEditorMode("chatter")}>说说编辑器</button><button className="editor-button editor-button--secondary" type="button" onClick={startNew}>新建文章</button>{editingSlug ? <button className="editor-button editor-button--danger" type="button" onClick={() => void remove()} disabled={saving}>删除文章</button> : null}<button className="editor-button" type="button" onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "保存文章"}</button></div></header>
      <div className="editor-layout">
        <aside className="editor-sidebar glass-card"><div className="editor-sidebar__title"><strong>文章</strong><span>{articles.length}</span></div>{loading ? <p className="editor-muted">正在读取…</p> : null}{!loading && !articles.length ? <p className="editor-muted">还没有文章</p> : null}<div className="editor-article-list">{articles.map((article) => <button key={article.slug} className={`editor-article-item${editingSlug === article.slug ? " is-active" : ""}`} type="button" onClick={() => void selectArticle(article.slug)}><strong>{article.title}</strong><small>{article.status} · {article.slug}</small></button>)}</div></aside>
        <section className="editor-workspace">
          <div className="editor-fields glass-card"><label>标题<input value={form.title} onChange={(event) => onTitleChange(event.target.value)} placeholder="文章标题" /></label><label>Slug<input value={form.slug} onChange={(event) => { setSlugTouched(true); update("slug", event.target.value.toLowerCase()); }} placeholder="article-slug" /></label><label>摘要<textarea value={form.summary} onChange={(event) => update("summary", event.target.value)} rows={2} placeholder="文章摘要" /></label><div className="editor-field-row"><label>标签<input value={form.tags} onChange={(event) => update("tags", event.target.value)} placeholder="notes, personal" /></label><label>状态<select value={form.status} onChange={(event) => update("status", event.target.value as EditorArticleInput["status"])}><option value="DRAFT">DRAFT</option><option value="PUBLISHED">PUBLISHED</option><option value="ARCHIVED">ARCHIVED</option></select></label><label>发布时间<input type="datetime-local" value={form.publishedAt} onChange={(event) => update("publishedAt", event.target.value)} /></label></div><div className="editor-file-row"><label className="editor-file-input">封面图（必填）<input ref={coverInputRef} type="file" accept=".svg,.png,.jpg,.jpeg,.webp,image/*" onChange={(event) => onCoverChange(event.target.files?.[0])} /></label><label className="editor-file-input">正文图片<input type="file" accept=".svg,.png,.jpg,.jpeg,.webp,.gif,image/*" multiple onChange={(event) => onAssetsChange(event.target.files)} /></label></div>{coverToCrop ? <CoverCropper file={coverToCrop} onCancel={() => { setCoverToCrop(null); if (coverInputRef.current) coverInputRef.current.value = ""; }} onApply={applyCoverCrop} /> : null}{coverPreview ? <img className="editor-cover-preview" src={resolveApiUrl(coverPreview)} alt="封面预览" /> : <p className="editor-muted">请选择一张封面图</p>}</div>
          <div className="editor-panels"><label className="editor-panel glass-card">Markdown 正文<textarea value={form.contentMarkdown} onChange={(event) => update("contentMarkdown", event.target.value)} placeholder="# 文章标题\n\n开始写作…" /></label><section className="editor-panel glass-card"><div className="editor-panel__label">实时预览</div><MarkdownRenderer source={previewSource} /></section></div>
        </section>
      </div>
      {message ? <p className="editor-message editor-message--success">{message}</p> : null}{error ? <p className="editor-message editor-message--error">{error}</p> : null}
    </main>
  );
}

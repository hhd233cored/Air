"use client";

import { useEffect, useMemo, useState } from "react";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { ApiRequestError } from "../lib/api/client";
import { deleteEditorChatter, getEditorChatter, getEditorChatterEntry, saveEditorChatter, type EditorChatterInput } from "../lib/api/chatter-editor";
import type { ChatterSummary } from "../lib/api/chatter";

type ChatterEditorProps = { onBack: () => void };

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

function slugifyContent(value: string) {
  const firstLine = value.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const slug = firstLine.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || `chatter-${Date.now()}`;
}

function emptyForm(): EditorChatterInput {
  return { slug: "", status: "DRAFT", publishedAt: "", contentMarkdown: "" };
}

function errorMessage(error: unknown) {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : "说说编辑器请求失败";
}

export function ChatterEditor({ onBack }: ChatterEditorProps) {
  const [entries, setEntries] = useState<ChatterSummary[]>([]);
  const [form, setForm] = useState<EditorChatterInput>(emptyForm);
  const [editingSlug, setEditingSlug] = useState<string | undefined>();
  const [slugTouched, setSlugTouched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const previewSource = useMemo(() => form.contentMarkdown || "在左侧输入说说内容，右侧会实时显示预览。", [form.contentMarkdown]);

  useEffect(() => {
    let active = true;
    getEditorChatter().then((response) => { if (active) setEntries(response.content); }).catch((reason) => { if (active) setError(errorMessage(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const update = <K extends keyof EditorChatterInput>(key: K, value: EditorChatterInput[K]) => setForm((previous) => ({ ...previous, [key]: value }));
  const startNew = () => { setEditingSlug(undefined); setForm(emptyForm()); setSlugTouched(false); setMessage(""); setError(""); };

  const selectEntry = async (slug: string) => {
    setLoading(true); setError("");
    try {
      const entry = await getEditorChatterEntry(slug);
      setEditingSlug(entry.slug);
      setForm({ slug: entry.slug, status: entry.status, publishedAt: toLocalDateTime(entry.publishedAt), contentMarkdown: entry.contentMarkdown });
      setSlugTouched(true); setMessage("");
    } catch (reason) { setError(errorMessage(reason)); } finally { setLoading(false); }
  };

  const onContentChange = (contentMarkdown: string) => {
    update("contentMarkdown", contentMarkdown);
    if (!slugTouched) update("slug", slugifyContent(contentMarkdown));
  };

  const save = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      if (!form.contentMarkdown.trim()) throw new Error("请填写说说内容");
      if (!form.slug.trim()) throw new Error("请填写 Slug");
      const saved = await saveEditorChatter({ ...form, publishedAt: toIsoDateTime(form.publishedAt) }, editingSlug);
      setEditingSlug(saved.slug);
      setForm((previous) => ({ ...previous, slug: saved.slug, publishedAt: toLocalDateTime(saved.publishedAt) }));
      const list = await getEditorChatter();
      setEntries(list.content);
      setMessage("说说已保存到 public/chatter");
    } catch (reason) { setError(errorMessage(reason)); } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!editingSlug) return;
    if (!window.confirm(`确定删除说说“${editingSlug}”吗？此操作不可撤销。`)) return;
    setSaving(true); setError(""); setMessage("");
    try {
      await deleteEditorChatter(editingSlug);
      const list = await getEditorChatter();
      setEntries(list.content);
      startNew();
      setMessage("说说已删除");
    } catch (reason) { setError(errorMessage(reason)); } finally { setSaving(false); }
  };

  return (
    <main className="editor-page">
      <header className="editor-header"><div><p className="card-kicker">LOCAL CHATTER EDITOR</p><h1>说说编辑器</h1></div><div className="editor-header__actions"><button className="editor-link" type="button" onClick={onBack}>文章编辑器</button><button className="editor-button editor-button--secondary" type="button" onClick={startNew}>新建说说</button>{editingSlug ? <button className="editor-button editor-button--danger" type="button" onClick={() => void remove()} disabled={saving}>删除说说</button> : null}<button className="editor-button" type="button" onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "保存说说"}</button></div></header>
      <div className="editor-layout">
        <aside className="editor-sidebar glass-card"><div className="editor-sidebar__title"><strong>说说</strong><span>{entries.length}</span></div>{loading ? <p className="editor-muted">正在读取…</p> : null}{!loading && !entries.length ? <p className="editor-muted">还没有说说</p> : null}<div className="editor-article-list">{entries.map((entry) => <button key={entry.slug} className={`editor-article-item${editingSlug === entry.slug ? " is-active" : ""}`} type="button" onClick={() => void selectEntry(entry.slug)}><strong>{entry.preview || entry.slug}</strong><small>{entry.status} · {entry.slug}</small></button>)}</div></aside>
        <section className="editor-workspace"><div className="editor-fields glass-card"><label>Slug<input value={form.slug} onChange={(event) => { setSlugTouched(true); update("slug", event.target.value.toLowerCase()); }} placeholder="life-changelog" /></label><div className="editor-field-row editor-field-row--chatter"><label>状态<select value={form.status} onChange={(event) => update("status", event.target.value)}><option value="DRAFT">DRAFT</option><option value="PUBLISHED">PUBLISHED</option><option value="ARCHIVED">ARCHIVED</option></select></label><label>发布时间<input type="datetime-local" value={form.publishedAt} onChange={(event) => update("publishedAt", event.target.value)} /></label></div></div><div className="editor-panels"><label className="editor-panel glass-card">Markdown 正文<textarea value={form.contentMarkdown} onChange={(event) => onContentChange(event.target.value)} placeholder="记录此刻…" /></label><section className="editor-panel glass-card"><div className="editor-panel__label">实时预览</div><MarkdownRenderer source={previewSource} /></section></div></section>
      </div>
      {message ? <p className="editor-message editor-message--success">{message}</p> : null}{error ? <p className="editor-message editor-message--error">{error}</p> : null}
    </main>
  );
}

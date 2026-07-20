"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiRequestError, resolveApiUrl } from "../../lib/api/client";
import { getCurrentUser } from "../../lib/api/auth";
import type { AuthUser } from "../../lib/api/auth";
import { NotFoundPage } from "../../components/NotFoundPage";
import {
  deleteAdminMusic,
  getAdminMusicPlaylist,
  uploadAdminMusic,
} from "../../lib/api/admin-users";
import type { MusicTrackSummary } from "../../lib/api/music";

function errorMessage(reason: unknown) {
  if (reason instanceof ApiRequestError) return reason.message;
  return reason instanceof Error ? reason.message : "请求失败，请稍后重试";
}

export default function AdminMusicPage() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tracks, setTracks] = useState<MusicTrackSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((response) => { if (active) setCurrentUser(response.user); })
      .catch((reason) => { if (active) setError(errorMessage(reason)); })
      .finally(() => { if (active) setAuthChecked(true); });
    return () => { active = false; };
  }, []);

  const loadTracks = useCallback(async () => {
    if (currentUser?.role !== "ADMIN") return;
    setLoading(true);
    setError("");
    try {
      const response = await getAdminMusicPlaylist();
      setTracks(response.tracks);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [currentUser?.role]);

  useEffect(() => {
    if (currentUser?.role !== "ADMIN") return undefined;
    const timer = window.setTimeout(() => { void loadTracks(); }, 0);
    return () => window.clearTimeout(timer);
  }, [currentUser?.role, loadTracks]);

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await uploadAdminMusic(file);
      setTracks(response.tracks);
      setMessage("音乐已上传并加入本地歌单");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (trackId: string) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await deleteAdminMusic(trackId);
      setTracks(response.tracks);
      setMessage("音乐已从本地歌单移除");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!authChecked) {
    return <main className="admin-page"><section className="glass-card admin-state">正在检查登录状态…</section></main>;
  }

  if (currentUser?.role !== "ADMIN") {
    return <NotFoundPage />;
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <p className="card-kicker">ADMIN / MUSIC</p>
          <h1>音乐管理</h1>
          <p className="admin-header__copy">上传、查看和删除服务器上的本地音乐。</p>
        </div>
        <Link className="editor-link" href="/admin/">返回账号管理</Link>
      </header>

      {message ? <p className="editor-message editor-message--success" role="status">{message}</p> : null}
      {error ? <p className="editor-message editor-message--error" role="alert">{error}</p> : null}

      <section className="admin-music glass-card">
        <div className="admin-section-heading">
          <div><p className="card-kicker">LOCAL MUSIC</p><h2>本地歌单 <small>{tracks.length} 首</small></h2></div>
          <label className="editor-button admin-music__upload">
            {busy ? "处理中…" : "上传音乐"}
            <input type="file" accept=".mp3,.m4a,.aac,.wav,.ogg,.flac,.webm,audio/*" disabled={busy} onChange={(event) => { void handleUpload(event.target.files?.[0]); event.target.value = ""; }} />
          </label>
        </div>
        <p className="admin-music__hint">音频标题、作者、专辑、时长和内嵌封面会从文件元数据读取；上传后自动加入本地歌单。</p>
        {loading ? <p className="admin-muted">正在加载音乐…</p> : null}
        {!loading && !error && tracks.length === 0 ? <p className="admin-muted">本地歌单还没有音乐。</p> : null}
        <div className="admin-music__list">
          {tracks.map((track) => (
            <article className="admin-music__row" key={track.id}>
              <div className="admin-music__cover">{track.coverUrl ? <img src={resolveApiUrl(track.coverUrl)} alt="" /> : null}</div>
              <div className="admin-music__identity"><strong>{track.title || "未命名歌曲"}</strong><small>{track.artist || "未知作者"}{track.album ? ` · ${track.album}` : ""}</small></div>
              <button className="admin-inline-action" type="button" disabled={busy} onClick={() => { if (window.confirm("确定要删除这首本地音乐吗？")) void handleDelete(track.id); }}>删除</button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

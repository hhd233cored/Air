"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiRequestError, resolveApiUrl } from "../lib/api/client";
import { getCurrentUser } from "../lib/api/auth";
import type { AuthUser } from "../lib/api/auth";
import { NotFoundPage } from "../components/NotFoundPage";
import {
  createAdminUser,
  deleteAdminAvatar,
  getAdminUsers,
  getRegistrationSetting,
  resetAdminPassword,
  updateAdminUser,
  updateRegistrationSetting,
  uploadAdminAvatar,
  type AdminUser,
  type AdminUserRole,
} from "../lib/api/admin-users";

const pageSize = 20;

function errorMessage(reason: unknown) {
  if (reason instanceof ApiRequestError) return reason.message;
  return reason instanceof Error ? reason.message : "请求失败，请稍后重试";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

function emptyCreateForm() {
  return { username: "", password: "", role: "USER" as AdminUserRole, enabled: true };
}

export default function AdminPage() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [roleFilter, setRoleFilter] = useState<AdminUserRole | "">("");
  const [enabledFilter, setEnabledFilter] = useState<"true" | "false" | "">("");
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [resetTarget, setResetTarget] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [registrationSaving, setRegistrationSaving] = useState(false);
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

  const loadUsers = useCallback(async () => {
    if (currentUser?.role !== "ADMIN") return;
    setLoading(true);
    setError("");
    try {
      const [response, registration] = await Promise.all([
        getAdminUsers({ page, size: pageSize, query, role: roleFilter, enabled: enabledFilter }),
        getRegistrationSetting(),
      ]);
      setUsers(response.content);
      setTotalPages(response.totalPages);
      setTotalElements(response.totalElements);
      setRegistrationEnabled(registration.enabled);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [currentUser?.role, enabledFilter, page, query, roleFilter]);

  const showSuccess = (text: string) => {
    setMessage(text);
    setError("");
  };

  const toggleRegistration = async () => {
    setRegistrationSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await updateRegistrationSetting(!registrationEnabled);
      setRegistrationEnabled(response.enabled);
      showSuccess(response.enabled ? "公开注册已开启" : "公开注册已关闭");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setRegistrationSaving(false);
    }
  };

  useEffect(() => {
    if (currentUser?.role !== "ADMIN") return undefined;
    const timer = window.setTimeout(() => { void loadUsers(); }, 0);
    return () => window.clearTimeout(timer);
  }, [currentUser?.role, loadUsers]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await createAdminUser(createForm);
      setCreateForm(emptyCreateForm());
      showSuccess("账号已创建");
      await loadUsers();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const updateUser = async (userId: number, input: { role?: AdminUserRole; enabled?: boolean }, successText: string) => {
    setBusyUserId(userId);
    setMessage("");
    setError("");
    try {
      const updated = await updateAdminUser(userId, input);
      setUsers((items) => items.map((item) => item.id === userId ? updated : item));
      showSuccess(successText);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (resetTarget === null) return;
    setBusyUserId(resetTarget);
    setMessage("");
    setError("");
    try {
      const updated = await resetAdminPassword(resetTarget, resetPassword);
      setUsers((items) => items.map((item) => item.id === resetTarget ? updated : item));
      setResetTarget(null);
      setResetPassword("");
      showSuccess("密码已重置，旧登录状态已失效");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleAvatar = async (userId: number, file: File | undefined) => {
    if (!file) return;
    setBusyUserId(userId);
    setMessage("");
    setError("");
    try {
      const updated = await uploadAdminAvatar(userId, file);
      setUsers((items) => items.map((item) => item.id === userId ? updated : item));
      showSuccess("头像已更新");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyUserId(null);
    }
  };

  const handleDeleteAvatar = async (userId: number) => {
    setBusyUserId(userId);
    setMessage("");
    setError("");
    try {
      const updated = await deleteAdminAvatar(userId);
      setUsers((items) => items.map((item) => item.id === userId ? updated : item));
      showSuccess("头像已清除");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyUserId(null);
    }
  };

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(0);
    setQuery(searchInput);
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
          <p className="card-kicker">ADMIN / USERS</p>
          <h1>账号管理</h1>
          <p className="admin-header__copy">管理用户角色、登录状态、密码和头像。</p>
        </div>
        <Link className="editor-link" href="/">返回首页</Link>
      </header>

      {message ? <p className="editor-message editor-message--success" role="status">{message}</p> : null}
      {error ? <p className="editor-message editor-message--error" role="alert">{error}</p> : null}

      <section className="admin-registration glass-card">
        <div>
          <p className="card-kicker">PUBLIC REGISTRATION</p>
          <h2>开放注册</h2>
          <p>{registrationEnabled ? "访客可以创建普通用户账号。" : "访客暂时不能注册新账号。"}</p>
        </div>
        <button className="editor-button editor-button--secondary" type="button" onClick={() => void toggleRegistration()} disabled={registrationSaving}>
          {registrationSaving ? "保存中…" : registrationEnabled ? "关闭注册" : "开放注册"}
        </button>
      </section>

      <section className="admin-create glass-card">
        <div className="admin-section-heading">
          <div><p className="card-kicker">NEW ACCOUNT</p><h2>创建账号</h2></div>
        </div>
        <form className="admin-create__form" onSubmit={handleCreate}>
          <label>用户名<input value={createForm.username} onChange={(event) => setCreateForm((form) => ({ ...form, username: event.target.value }))} pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,63}" required /></label>
          <label>初始密码<input type="password" value={createForm.password} onChange={(event) => setCreateForm((form) => ({ ...form, password: event.target.value }))} minLength={8} required /></label>
          <label>角色<select value={createForm.role} onChange={(event) => setCreateForm((form) => ({ ...form, role: event.target.value as AdminUserRole }))}><option value="USER">普通用户</option><option value="ADMIN">管理员</option></select></label>
          <label className="admin-checkbox"><input type="checkbox" checked={createForm.enabled} onChange={(event) => setCreateForm((form) => ({ ...form, enabled: event.target.checked }))} />立即启用</label>
          <button className="editor-button" type="submit" disabled={saving}>{saving ? "创建中…" : "创建账号"}</button>
        </form>
      </section>

      <section className="admin-users glass-card">
        <div className="admin-section-heading">
          <div><p className="card-kicker">USER DIRECTORY</p><h2>用户列表 <small>{totalElements} 个账号</small></h2></div>
          <span className="admin-section-heading__current">当前管理员：{currentUser.username}</span>
        </div>
        <form className="admin-filters" onSubmit={applySearch}>
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜索用户名…" aria-label="搜索用户名" />
          <select value={roleFilter} onChange={(event) => { setPage(0); setRoleFilter(event.target.value as AdminUserRole | ""); }} aria-label="按角色筛选"><option value="">全部角色</option><option value="USER">普通用户</option><option value="ADMIN">管理员</option></select>
          <select value={enabledFilter} onChange={(event) => { setPage(0); setEnabledFilter(event.target.value as "true" | "false" | ""); }} aria-label="按状态筛选"><option value="">全部状态</option><option value="true">已启用</option><option value="false">已停用</option></select>
          <button className="editor-button editor-button--secondary" type="submit">搜索</button>
        </form>

        {loading ? <p className="admin-muted">正在加载用户…</p> : null}
        {!loading && users.length === 0 ? <p className="admin-muted">没有符合条件的账号。</p> : null}
        <div className="admin-user-list">
          {users.map((user) => (
            <article className={`admin-user-row${user.enabled ? "" : " is-disabled"}`} key={user.id}>
              <div className="admin-user-row__avatar">
                {user.avatarUrl ? <img src={resolveApiUrl(user.avatarUrl)} alt="" /> : <span aria-hidden="true" />}
              </div>
              <div className="admin-user-row__identity"><strong>{user.username}</strong><small>ID {user.id} · 创建于 {formatDate(user.createdAt)}</small></div>
              <label className="admin-user-row__field">角色<select value={user.role} disabled={busyUserId === user.id} onChange={(event) => void updateUser(user.id, { role: event.target.value as AdminUserRole }, "角色已更新")}><option value="USER">普通用户</option><option value="ADMIN">管理员</option></select></label>
                <label className="admin-user-row__enabled"><input type="checkbox" checked={user.enabled} disabled={busyUserId === user.id} onChange={(event) => void updateUser(user.id, { enabled: event.target.checked }, event.target.checked ? "账号已启用" : "账号已停用")} />{user.enabled ? "已启用" : "已停用"}</label>
              <div className="admin-user-row__actions">
                <label className="admin-inline-action">头像<input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" disabled={busyUserId === user.id} onChange={(event) => { void handleAvatar(user.id, event.target.files?.[0]); event.target.value = ""; }} /></label>
                {user.avatarUrl ? <button className="admin-inline-action" type="button" disabled={busyUserId === user.id} onClick={() => void handleDeleteAvatar(user.id)}>清除头像</button> : null}
                <button className="admin-inline-action" type="button" disabled={busyUserId === user.id} onClick={() => { setResetTarget(resetTarget === user.id ? null : user.id); setResetPassword(""); }}>重置密码</button>
              </div>
              {resetTarget === user.id ? <form className="admin-reset-form" onSubmit={handleResetPassword}><input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="输入新密码" minLength={8} required /><button className="editor-button" type="submit" disabled={busyUserId === user.id}>确认</button></form> : null}
            </article>
          ))}
        </div>
        {totalPages > 1 ? <nav className="admin-pagination" aria-label="账号分页"><button type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>上一页</button><span>{page + 1} / {totalPages}</span><button type="button" disabled={page >= totalPages - 1} onClick={() => setPage((current) => current + 1)}>下一页</button></nav> : null}
      </section>
    </main>
  );
}

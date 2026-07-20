"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { ApiRequestError, resolveApiUrl } from "../lib/api/client";
import { deleteAvatar, login, logout, register, uploadAvatar } from "../lib/api/auth";
import type { AuthUser } from "../lib/api/auth";

type AuthPanelProps = {
  user: AuthUser | null;
  onUserChange: (user: AuthUser | null) => void;
  onClose: () => void;
  onOpenAdmin?: () => void;
  onOpenMusic?: () => void;
  onOpenEditor?: () => void;
};

type AuthMode = "login" | "register";

function roleLabel(role: AuthUser["role"]) {
  return role === "ADMIN" ? "管理员" : "普通用户";
}

export function AuthPanel({ user, onUserChange, onClose, onOpenAdmin, onOpenMusic, onOpenEditor }: AuthPanelProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [avatarSubmitting, setAvatarSubmitting] = useState(false);

  const changeAvatar = async (file: File | undefined) => {
    if (!file) return;
    setAvatarSubmitting(true);
    setError("");
    try {
      const response = await uploadAvatar(file);
      onUserChange(response.user);
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.message : "头像上传失败");
    } finally {
      setAvatarSubmitting(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarSubmitting(true);
    setError("");
    try {
      const response = await deleteAvatar();
      onUserChange(response.user);
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.message : "头像删除失败");
    } finally {
      setAvatarSubmitting(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "register" && password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = mode === "register"
        ? await register(username.trim(), password)
        : await login(username.trim(), password);
      onUserChange(response.user);
      onClose();
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.message : `${mode === "register" ? "注册" : "登录"}失败，请稍后重试`);
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    setSubmitting(true);
    setError("");
    try {
      await logout();
      onUserChange(null);
      onClose();
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.message : "退出失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode((current) => current === "login" ? "register" : "login");
    setPassword("");
    setConfirmation("");
    setError("");
  };

  return (
    <div className="auth-popover" role="dialog" aria-label={user ? "当前用户" : mode === "login" ? "登录" : "注册"}>
      {user ? (
        <>
          <div className="auth-popover__profile">
            {user.avatarUrl ? (
              <img src={resolveApiUrl(user.avatarUrl)} alt="" />
            ) : (
              <span className="auth-popover__profile-avatar--empty" aria-hidden="true" />
            )}
            <div>
              <p className="auth-popover__eyebrow">CURRENT USER</p>
              <p className="auth-popover__name">{user.username}</p>
              <p className="auth-popover__role">{roleLabel(user.role)}</p>
            </div>
          </div>
          <label className="auth-popover__avatar-upload">
            {avatarSubmitting ? "处理中…" : "更换头像"}
            <input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={(event) => void changeAvatar(event.target.files?.[0])} disabled={avatarSubmitting} />
          </label>
          {user.avatarUrl ? <button className="auth-popover__switch" type="button" onClick={() => void removeAvatar()} disabled={avatarSubmitting}>删除头像</button> : null}
          {user.role === "ADMIN" && onOpenAdmin ? <button className="auth-popover__submit auth-popover__admin-link" type="button" onClick={onOpenAdmin}>账号管理</button> : null}
          {user.role === "ADMIN" && onOpenMusic ? <button className="auth-popover__submit auth-popover__admin-link" type="button" onClick={onOpenMusic}>音乐管理</button> : null}
          {user.role === "ADMIN" && onOpenEditor ? <button className="auth-popover__submit auth-popover__admin-link" type="button" onClick={onOpenEditor}>文章编辑器</button> : null}
          <button className="auth-popover__submit" type="button" onClick={signOut} disabled={submitting}>
            {submitting ? "处理中…" : "退出登录"}
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <p className="auth-popover__eyebrow">ACCOUNT / {mode === "login" ? "LOGIN" : "REGISTER"}</p>
          <label className="auth-popover__label">
            用户名
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
          </label>
          <label className="auth-popover__label">
            密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 8 : undefined} required />
          </label>
          {mode === "register" ? (
            <label className="auth-popover__label">
              确认密码
              <input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required />
            </label>
          ) : null}
          {error ? <p className="auth-popover__error" role="alert">{error}</p> : null}
          <button className="auth-popover__submit" type="submit" disabled={submitting}>
            {submitting ? `${mode === "register" ? "注册" : "登录"}中…` : mode === "register" ? "注册并登录" : "登录"}
          </button>
          <button className="auth-popover__switch" type="button" onClick={switchMode}>
            {mode === "login" ? "还没有账号？注册" : "已有账号？返回登录"}
          </button>
        </form>
      )}
      {user && error ? <p className="auth-popover__error" role="alert">{error}</p> : null}
    </div>
  );
}

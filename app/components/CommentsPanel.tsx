"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ApiRequestError, resolveApiUrl } from "../lib/api/client";
import { createComment, deleteComment, getComments } from "../lib/api/comments";
import type { CommentItem, CommentTargetType } from "../lib/api/comments";
import type { AuthUser } from "../lib/api/auth";

type CommentsPanelProps = {
  targetType: CommentTargetType;
  targetSlug: string;
  currentUser: AuthUser | null;
  onRequestLogin?: () => void;
  defaultOpen?: boolean;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const datePart = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
  const timePart = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${datePart}  ${timePart}`;
}

function avatarUrl(value: string | null | undefined) {
  return resolveApiUrl(value);
}

export function CommentsPanel({
  targetType,
  targetSlug,
  currentUser,
  onRequestLogin,
  defaultOpen = false,
}: CommentsPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [content, setContent] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open && targetType !== "CHATTER" && targetType !== "GUESTBOOK") return;
    let active = true;
    const requestSize = open ? 20 : 1;
    getComments(targetType, targetSlug, 0, requestSize)
      .then((result) => {
        if (!active) return;
        setCommentCount(result.totalElements);
        if (open) setComments(result.content);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof ApiRequestError ? reason.message : "评论暂时无法加载");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, targetSlug, targetType]);

  const roots = useMemo(() => comments.filter((comment) => comment.parentId === null), [comments]);
  const replies = useMemo(() => {
    const grouped = new Map<number, CommentItem[]>();
    comments.filter((comment) => comment.parentId !== null).forEach((comment) => {
      const parentId = comment.parentId as number;
      grouped.set(parentId, [...(grouped.get(parentId) ?? []), comment]);
    });
    return grouped;
  }, [comments]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser) {
      onRequestLogin?.();
      return;
    }
    if (!content.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const created = await createComment(targetType, targetSlug, content, replyTo);
      setComments((existing) => [...existing, created]);
      setCommentCount((count) => (count ?? comments.length) + 1);
      setContent("");
      setReplyTo(null);
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.message : "评论发布失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleOpen = () => {
    const nextOpen = !open;
    if (nextOpen) {
      setLoading(true);
      setError("");
    }
    setOpen(nextOpen);
  };

  const remove = async (comment: CommentItem) => {
    if (!window.confirm("确定删除这条评论吗？")) return;
    try {
      await deleteComment(comment.id, targetType);
      setComments((existing) => existing.filter((item) => item.id !== comment.id));
      setCommentCount((count) => Math.max(0, (count ?? comments.length) - 1));
    } catch (reason) {
      setError(reason instanceof ApiRequestError ? reason.message : "评论删除失败");
    }
  };

  return (
    <section className={`comments-panel comments-panel--${targetType.toLowerCase()}${open ? " is-open" : ""}`}>
      {targetType === "GUESTBOOK" ? null : targetType === "CHATTER" ? (
        <button className="comments-panel__toggle comments-panel__toggle--tweet" type="button" aria-label="打开评论" onClick={toggleOpen}>
          <span className="comments-panel__tweet-action">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11.5c0 4.7-3.6 8.5-8 8.5-1.4 0-2.7-.3-3.9-.9L4 20l1.1-3.2C4.4 15.4 4 13.5 4 11.5 4 6.8 7.6 3 12 3s8 3.8 8 8.5Z" />
            </svg>
            <span>{(commentCount ?? comments.length) || ""}</span>
          </span>
        </button>
      ) : (
        <button className="comments-panel__toggle" type="button" onClick={toggleOpen}>
          <span>{targetType === "GUESTBOOK" ? "留言" : "评论"}</span>
          <span>{open ? "−" : `${comments.length || ""} 条`}</span>
        </button>
      )}
      {open ? (
        <div className="comments-panel__body">
          {loading ? <p className="comments-panel__muted">正在读取评论…</p> : null}
          {!loading && !error && roots.length === 0 ? <p className="comments-panel__muted">{targetType === "GUESTBOOK" ? "还没有留言。" : "还没有评论。"}</p> : null}
          {roots.map((comment) => (
            <div className="comment-thread" key={comment.id}>
              <CommentRow
                comment={comment}
                currentUser={currentUser}
                onReply={() => setReplyTo(comment.id)}
                onDelete={() => remove(comment)}
              />
              {(replies.get(comment.id) ?? []).map((reply) => (
                <div className="comment-thread__reply" key={reply.id}>
                  <CommentRow comment={reply} currentUser={currentUser} onDelete={() => remove(reply)} />
                </div>
              ))}
            </div>
          ))}
          {error ? <p className="comments-panel__error" role="alert">{error}</p> : null}
          <form className="comments-panel__form" onSubmit={submit}>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={currentUser ? (replyTo ? "回复这条评论…" : targetType === "GUESTBOOK" ? "写下你的留言…" : "写下你的评论…") : targetType === "GUESTBOOK" ? "登录后发表留言" : "登录后发表评论"}
              maxLength={1000}
              rows={3}
              onFocus={() => {
                if (!currentUser) onRequestLogin?.();
              }}
              disabled={!currentUser || submitting}
            />
            <div className="comments-panel__form-actions">
              {replyTo ? <button type="button" className="comments-panel__cancel" onClick={() => setReplyTo(null)}>取消回复</button> : null}
              <button type="submit" className="comments-panel__submit" disabled={!currentUser || submitting || !content.trim()}>
                {submitting ? "发布中…" : "发布评论"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function CommentRow({
  comment,
  currentUser,
  onReply,
  onDelete,
}: {
  comment: CommentItem;
  currentUser: AuthUser | null;
  onReply?: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="comment-row">
      {avatarUrl(comment.author.avatarUrl) ? (
        <img className="comment-row__avatar" src={avatarUrl(comment.author.avatarUrl)} alt="" />
      ) : (
        <span className="comment-row__avatar comment-row__avatar--empty" aria-hidden="true" />
      )}
      <div className="comment-row__content">
        <div className="comment-row__meta">
          <strong>{comment.author.username}</strong>
          <time>{formatDate(comment.createdAt)}</time>
        </div>
        <p>{comment.content}</p>
        <div className="comment-row__actions">
          {onReply ? <button type="button" onClick={onReply}>回复</button> : null}
          {currentUser && (currentUser.id === comment.author.id || currentUser.role === "ADMIN") ? (
            <button type="button" onClick={onDelete}>删除</button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

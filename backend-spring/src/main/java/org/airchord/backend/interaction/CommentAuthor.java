package org.airchord.backend.interaction;

/** 评论公开作者字段；不返回账号邮箱、密码哈希或其他管理信息。 */
public record CommentAuthor(long id, String username, String avatarUrl) {
}

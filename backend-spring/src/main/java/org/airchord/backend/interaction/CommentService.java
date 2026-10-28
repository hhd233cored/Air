package org.airchord.backend.interaction;

import org.airchord.backend.content.ContentItemRecord;
import org.airchord.backend.content.ContentReadRepository;
import org.airchord.backend.web.BackendApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;

/** 评论规则集中在 Service：目标必须公开、回复只能一级、删除由作者或管理员执行。 */
@Service
public class CommentService {

    private final CommentRepository comments;
    private final ContentReadRepository content;
    private final boolean enabled;
    private final int maxLength;

    public CommentService(
            CommentRepository comments,
            ContentReadRepository content,
            @Value("${airchord.comments.enabled:true}") boolean enabled,
            @Value("${airchord.comments.max-length:1000}") int maxLength
    ) {
        this.comments = comments;
        this.content = content;
        this.enabled = enabled;
        this.maxLength = maxLength;
    }

    public CommentPageResponse listPublic(String type, String slug, int page, int size) {
        requireEnabled();
        validatePage(page, size);
        String targetId = publishedTarget(type, slug).slug();
        return page(comments.listPublic(type, targetId, page, size), page, size);
    }

    @Transactional
    public CommentResponse create(String type, String slug, long userId, Long parentId, String rawContent) {
        requireEnabled();
        ContentItemRecord target = publishedTarget(type, slug);
        String body = rawContent == null ? "" : rawContent.strip();
        if (body.isEmpty()) throw new BackendApiException("COMMENT_EMPTY", "评论内容不能为空", 400);
        if (body.length() > maxLength) throw new BackendApiException("COMMENT_TOO_LONG", "评论内容过长", 400);
        if (parentId != null) {
            CommentRepository.Parent parent = comments.findParent(parentId);
            if (parent == null || !"VISIBLE".equals(parent.status())
                    || !type.equals(parent.type()) || !target.slug().equals(parent.targetId())
                    || parent.parentId() != null) {
                throw new BackendApiException("COMMENT_INVALID_PARENT", "只允许回复同一内容下的一级评论", 400);
            }
        }
        return comments.create(type, target.slug(), userId, parentId, body);
    }

    @Transactional
    public void delete(long commentId, long actorId, boolean admin) {
        requireEnabled();
        Long ownerId = comments.ownerId(commentId);
        if (ownerId == null) throw new BackendApiException("COMMENT_NOT_FOUND", "评论不存在", 404);
        if (!admin && ownerId != actorId) throw new BackendApiException("AUTH_FORBIDDEN", "不能删除其他用户的评论", 403);
        comments.softDelete(commentId);
    }

    public CommentPageResponse listAdmin(String status, int page, int size) {
        validatePage(page, size);
        String normalized = status == null || status.isBlank() ? null : status.toUpperCase(Locale.ROOT);
        if (normalized != null && !List.of("VISIBLE", "HIDDEN", "DELETED").contains(normalized)) {
            throw new BackendApiException("COMMENT_INVALID_STATUS", "评论状态无效", 400);
        }
        return page(comments.listAdmin(normalized, page, size), page, size);
    }

    @Transactional
    public CommentResponse updateStatus(long commentId, String status) {
        String normalized = status == null ? "" : status.toUpperCase(Locale.ROOT);
        if (!List.of("VISIBLE", "HIDDEN", "DELETED").contains(normalized)) {
            throw new BackendApiException("COMMENT_INVALID_STATUS", "评论状态无效", 400);
        }
        CommentResponse updated = comments.updateStatus(commentId, normalized);
        if (updated == null) throw new BackendApiException("COMMENT_NOT_FOUND", "评论不存在", 404);
        return updated;
    }

    private ContentItemRecord publishedTarget(String type, String slug) {
        ContentItemRecord target = content.findPublished(type, slug);
        if (target == null) throw new BackendApiException("COMMENT_TARGET_NOT_FOUND", "评论目标不存在", 404);
        return target;
    }

    private void requireEnabled() {
        if (!enabled) throw new BackendApiException("COMMENTS_DISABLED", "评论功能未开启", 404);
    }

    private static void validatePage(int page, int size) {
        if (page < 0 || size < 1 || size > 100) {
            throw new BackendApiException("BAD_REQUEST", "分页参数无效", 400);
        }
    }

    static CommentPageResponse page(CommentRepository.Page result, int page, int size) {
        int totalPages = result.totalElements() == 0 ? 0 : (int) ((result.totalElements() + size - 1) / size);
        return new CommentPageResponse(result.content(), page, size, result.totalElements(), totalPages);
    }
}

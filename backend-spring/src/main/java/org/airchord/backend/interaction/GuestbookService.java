package org.airchord.backend.interaction;

import org.airchord.backend.web.BackendApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 留言板不支持回复；与文章评论分表，但复用同一组 JSON 响应字段。 */
@Service
public class GuestbookService {

    private final GuestbookRepository repository;
    private final boolean enabled;
    private final int maxLength;

    public GuestbookService(
            GuestbookRepository repository,
            @Value("${airchord.comments.enabled:true}") boolean enabled,
            @Value("${airchord.comments.max-length:1000}") int maxLength
    ) {
        this.repository = repository;
        this.enabled = enabled;
        this.maxLength = maxLength;
    }

    public CommentPageResponse list(int page, int size) {
        requireEnabled();
        validatePage(page, size);
        return CommentService.page(repository.listPublic(page, size), page, size);
    }

    @Transactional
    public CommentResponse create(long userId, String rawContent, Long parentId) {
        requireEnabled();
        if (parentId != null) throw new BackendApiException("COMMENT_INVALID_PARENT", "留言板不支持回复", 400);
        String content = rawContent == null ? "" : rawContent.strip();
        if (content.isEmpty()) throw new BackendApiException("GUESTBOOK_EMPTY", "留言内容不能为空", 400);
        if (content.length() > maxLength) throw new BackendApiException("GUESTBOOK_TOO_LONG", "留言内容过长", 400);
        return repository.create(userId, content);
    }

    @Transactional
    public void delete(long id, long actorId, boolean admin) {
        requireEnabled();
        Long owner = repository.ownerId(id);
        if (owner == null) throw new BackendApiException("GUESTBOOK_NOT_FOUND", "留言不存在", 404);
        if (!admin && owner != actorId) throw new BackendApiException("AUTH_FORBIDDEN", "不能删除其他用户的留言", 403);
        repository.softDelete(id);
    }

    private void requireEnabled() {
        if (!enabled) throw new BackendApiException("COMMENTS_DISABLED", "留言板未开启", 404);
    }

    private static void validatePage(int page, int size) {
        if (page < 0 || size < 1 || size > 100) {
            throw new BackendApiException("BAD_REQUEST", "分页参数无效", 400);
        }
    }
}

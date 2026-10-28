package org.airchord.backend.interaction;

import jakarta.validation.Valid;
import org.airchord.backend.auth.AuthPrincipal;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 评论、留言板和管理员审核路由；写操作受 Spring Security 的 session 与 CSRF 保护。 */
@RestController
@RequestMapping("/api/v1")
public class InteractionController {

    private final CommentService comments;
    private final GuestbookService guestbook;

    public InteractionController(CommentService comments, GuestbookService guestbook) {
        this.comments = comments;
        this.guestbook = guestbook;
    }

    @GetMapping("/articles/{slug}/comments")
    public CommentPageResponse articleComments(
            @PathVariable String slug,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return comments.listPublic("ARTICLE", slug, page, size);
    }

    @PostMapping("/articles/{slug}/comments")
    public ResponseEntity<CommentResponse> createArticleComment(
            @PathVariable String slug,
            @Valid @RequestBody CommentCreateRequest body,
            @AuthenticationPrincipal AuthPrincipal user
    ) {
        return ResponseEntity.status(201).body(comments.create("ARTICLE", slug, user.id(), body.parentId(), body.content()));
    }

    @GetMapping("/chatter/{slug}/comments")
    public CommentPageResponse chatterComments(
            @PathVariable String slug,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return comments.listPublic("CHATTER", slug, page, size);
    }

    @PostMapping("/chatter/{slug}/comments")
    public ResponseEntity<CommentResponse> createChatterComment(
            @PathVariable String slug,
            @Valid @RequestBody CommentCreateRequest body,
            @AuthenticationPrincipal AuthPrincipal user
    ) {
        return ResponseEntity.status(201).body(comments.create("CHATTER", slug, user.id(), body.parentId(), body.content()));
    }

    @DeleteMapping("/comments/{commentId}")
    public ResponseEntity<Void> deleteComment(
            @PathVariable long commentId,
            @AuthenticationPrincipal AuthPrincipal user
    ) {
        comments.delete(commentId, user.id(), user.role().equals("ADMIN"));
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/guestbook/messages")
    public CommentPageResponse guestbook(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        return guestbook.list(page, size);
    }

    @PostMapping("/guestbook/messages")
    public ResponseEntity<CommentResponse> createGuestbookMessage(
            @Valid @RequestBody CommentCreateRequest body,
            @AuthenticationPrincipal AuthPrincipal user
    ) {
        return ResponseEntity.status(201).body(guestbook.create(user.id(), body.content(), body.parentId()));
    }

    @DeleteMapping("/guestbook/messages/{messageId}")
    public ResponseEntity<Void> deleteGuestbookMessage(
            @PathVariable long messageId,
            @AuthenticationPrincipal AuthPrincipal user
    ) {
        guestbook.delete(messageId, user.id(), user.role().equals("ADMIN"));
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/admin/comments")
    public CommentPageResponse adminComments(
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size
    ) {
        return comments.listAdmin(status, page, size);
    }

    @PatchMapping("/admin/comments/{commentId}")
    public CommentResponse updateCommentStatus(
            @PathVariable long commentId,
            @Valid @RequestBody CommentStatusRequest body
    ) {
        return comments.updateStatus(commentId, body.status());
    }
}

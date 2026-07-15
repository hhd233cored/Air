package com.yourspace.article.service;

import com.yourspace.article.dto.CreateArticleRequest;
import com.yourspace.article.entity.Article;
import com.yourspace.article.entity.ArticleStatus;
import com.yourspace.article.repository.ArticleRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ArticleServiceTest {
    @Mock
    private ArticleRepository repository;

    @InjectMocks
    private ArticleService service;

    @Test
    void createsDraftWithNormalizedSlugAndTags() {
        when(repository.existsBySlug("quiet-corner")).thenReturn(false);
        when(repository.save(any(Article.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var response = service.create(new CreateArticleRequest(
                "Quiet-Corner",
                "Quiet Corner",
                "A short note",
                null,
                "# Hello",
                Set.of("Design", "Notes")
        ));

        assertThat(response.slug()).isEqualTo("quiet-corner");
        assertThat(response.status()).isEqualTo(ArticleStatus.DRAFT);
        assertThat(response.tags()).containsExactlyInAnyOrder("design", "notes");
        verify(repository).save(any(Article.class));
    }

    @Test
    void publishesAnExistingDraft() {
        UUID id = UUID.randomUUID();
        Article article = new Article("draft-note", "Draft note", null, null, "# Draft", Set.of());
        when(repository.findById(id)).thenReturn(java.util.Optional.of(article));
        when(repository.save(any(Article.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var response = service.publish(id);

        assertThat(response.status()).isEqualTo(ArticleStatus.PUBLISHED);
        assertThat(response.publishedAt()).isNotNull();
    }
}

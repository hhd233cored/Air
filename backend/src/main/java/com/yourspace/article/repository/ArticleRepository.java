package com.yourspace.article.repository;

import com.yourspace.article.entity.Article;
import com.yourspace.article.entity.ArticleStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface ArticleRepository extends JpaRepository<Article, UUID> {
    boolean existsBySlug(String slug);

    boolean existsBySlugAndIdNot(String slug, UUID id);

    Optional<Article> findBySlugAndStatus(String slug, ArticleStatus status);

    Page<Article> findAllByStatus(ArticleStatus status, Pageable pageable);

    @Query("select distinct a from Article a join a.tags tag where a.status = :status and tag = :tag")
    Page<Article> findAllByStatusAndTag(@Param("status") ArticleStatus status, @Param("tag") String tag, Pageable pageable);
}

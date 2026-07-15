package com.yourspace.article.entity;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

@Entity
@Table(name = "articles", uniqueConstraints = @UniqueConstraint(name = "uk_articles_slug", columnNames = "slug"))
public class Article {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, length = 160)
    private String slug;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(length = 500)
    private String summary;

    @Column(name = "cover_url", length = 1000)
    private String coverUrl;

    @Column(name = "content_markdown", nullable = false, columnDefinition = "TEXT")
    private String contentMarkdown;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ArticleStatus status = ArticleStatus.DRAFT;

    @Column(name = "published_at")
    private Instant publishedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "article_tags", joinColumns = @JoinColumn(name = "article_id"))
    @Column(name = "tag", nullable = false, length = 50)
    @OrderBy("tag asc")
    private Set<String> tags = new LinkedHashSet<>();

    protected Article() {
    }

    public Article(String slug, String title, String summary, String coverUrl, String contentMarkdown, Set<String> tags) {
        this.slug = slug;
        this.title = title;
        this.summary = summary;
        this.coverUrl = coverUrl;
        this.contentMarkdown = contentMarkdown;
        this.tags = tags == null ? new LinkedHashSet<>() : new LinkedHashSet<>(tags);
    }

    public UUID getId() { return id; }
    public String getSlug() { return slug; }
    public void setSlug(String slug) { this.slug = slug; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getSummary() { return summary; }
    public void setSummary(String summary) { this.summary = summary; }
    public String getCoverUrl() { return coverUrl; }
    public void setCoverUrl(String coverUrl) { this.coverUrl = coverUrl; }
    public String getContentMarkdown() { return contentMarkdown; }
    public void setContentMarkdown(String contentMarkdown) { this.contentMarkdown = contentMarkdown; }
    public ArticleStatus getStatus() { return status; }
    public void setStatus(ArticleStatus status) { this.status = status; }
    public Instant getPublishedAt() { return publishedAt; }
    public void setPublishedAt(Instant publishedAt) { this.publishedAt = publishedAt; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Set<String> getTags() { return tags; }
    public void setTags(Set<String> tags) { this.tags = tags == null ? new LinkedHashSet<>() : new LinkedHashSet<>(tags); }
}

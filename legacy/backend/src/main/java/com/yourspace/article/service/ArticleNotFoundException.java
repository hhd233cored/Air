package com.yourspace.article.service;

import java.util.UUID;

public class ArticleNotFoundException extends RuntimeException {
    public ArticleNotFoundException(UUID id) {
        super("Article not found: " + id);
    }

    public ArticleNotFoundException(String slug) {
        super("Article not found: " + slug);
    }
}

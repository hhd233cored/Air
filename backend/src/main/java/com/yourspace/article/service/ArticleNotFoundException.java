package com.yourspace.article.service;

public class ArticleNotFoundException extends RuntimeException {
    public ArticleNotFoundException(String slug) {
        super("Article not found: " + slug);
    }
}

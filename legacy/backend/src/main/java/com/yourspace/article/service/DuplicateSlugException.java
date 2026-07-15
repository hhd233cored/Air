package com.yourspace.article.service;

public class DuplicateSlugException extends RuntimeException {
    public DuplicateSlugException(String slug) {
        super("Article slug already exists: " + slug);
    }
}

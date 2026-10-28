package org.airchord.backend.metrics;

/** Set before a background transaction starts; restore context even when publishing or consuming fails. */
final class ArticleMetricBackgroundScope implements AutoCloseable {
    private static final ThreadLocal<Boolean> BACKGROUND = new ThreadLocal<>();
    private final Boolean previous;
    private ArticleMetricBackgroundScope() { previous = BACKGROUND.get(); BACKGROUND.set(true); }
    static ArticleMetricBackgroundScope enter() { return new ArticleMetricBackgroundScope(); }
    static boolean active() { return Boolean.TRUE.equals(BACKGROUND.get()); }
    @Override public void close() { if (previous == null) BACKGROUND.remove(); else BACKGROUND.set(previous); }
}

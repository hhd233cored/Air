package org.airchord.backend.content;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** 生成与 Python 数据库模式相同的纯文本说说摘要。 */
public final class MarkdownPreview {

    private static final Pattern IMAGE = Pattern.compile("!\\[[^]]*]\\([^)]*\\)");
    private static final Pattern LINK = Pattern.compile("\\[([^]]+)]\\([^)]*\\)");
    private static final Pattern LIST_PREFIX = Pattern.compile("^\\s*(?:[-*+]\\s+|\\d+[.)]\\s+|>\\s*)");
    private static final Pattern MARKDOWN = Pattern.compile("[`*_~>#\\u00a0]");
    private static final int MAX_LENGTH = 160;

    private MarkdownPreview() {
    }

    public static String from(String markdown) {
        // 图片不参与预览；链接只保留用户可见的标签文字。
        String withoutImages = IMAGE.matcher(markdown).replaceAll("");
        String withoutLinkTargets = LINK.matcher(withoutImages).replaceAll("$1");
        List<String> visibleLines = new ArrayList<>();
        for (String line : withoutLinkTargets.split("\\R")) {
            String cleaned = LIST_PREFIX.matcher(line).replaceFirst("");
            cleaned = MARKDOWN.matcher(cleaned).replaceAll("").strip();
            if (!cleaned.isEmpty()) visibleLines.add(cleaned);
        }
        String preview = String.join(" ", visibleLines);
        if (preview.length() <= MAX_LENGTH) return preview;
        return preview.substring(0, MAX_LENGTH - 1).stripTrailing() + "…";
    }
}

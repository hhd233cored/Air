-- 阶段 1：保留 Python content_items 中的原始 cover_path 字段语义。
-- API 会先验证相应媒体文件存在，再把相对文件路径转换成公开 URL。

ALTER TABLE content_items RENAME COLUMN cover_url TO cover_path;

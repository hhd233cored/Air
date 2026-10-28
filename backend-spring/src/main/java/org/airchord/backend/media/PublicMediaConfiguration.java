package org.airchord.backend.media;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Path;

/** 继续从仓库的 public 资源目录提供文章图片和说说附件，不把二进制塞进数据库。 */
@Configuration
public class PublicMediaConfiguration implements WebMvcConfigurer {

    private final String articleLocation;
    private final String chatterLocation;
    private final String musicLocation;

    public PublicMediaConfiguration(
            @Value("${airchord.media.articles-dir:../public/articles}") String articleDirectory,
            @Value("${airchord.media.chatter-dir:../public/chatter}") String chatterDirectory,
            @Value("${airchord.media.music-dir:../music}") String musicDirectory
    ) {
        this.articleLocation = asDirectoryUri(articleDirectory);
        this.chatterLocation = asDirectoryUri(chatterDirectory);
        this.musicLocation = asDirectoryUri(musicDirectory);
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // ResourceHttpRequestHandler 将路径限制在配置目录下，并保留原来的 /articles 与 /chatter URL。
        registry.addResourceHandler("/articles/**").addResourceLocations(articleLocation);
        registry.addResourceHandler("/chatter/**").addResourceLocations(chatterLocation);
        registry.addResourceHandler("/music/**").addResourceLocations(musicLocation);
    }

    private static String asDirectoryUri(String directory) {
        String location = Path.of(directory).toAbsolutePath().normalize().toUri().toString();
        return location.endsWith("/") ? location : location + "/";
    }
}

package org.airchord.backend.auth;

import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;

/** 用户头像是公开读取的静态数据；写入只能通过当前用户的认证接口。 */
@RestController
@RequestMapping("/api/v1/users")
public class AvatarController {

    private final AuthService authService;

    public AvatarController(AuthService authService) {
        this.authService = authService;
    }

    @GetMapping("/{userId}/avatar")
    public ResponseEntity<byte[]> avatar(@PathVariable long userId) {
        UserAvatar avatar = authService.findAvatar(userId);
        if (avatar == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(avatar.contentType()))
                .cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePublic())
                .header("X-Content-Type-Options", "nosniff")
                .body(avatar.data());
    }
}

package org.airchord.backend.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.airchord.backend.ratelimit.InMemoryRateLimiter;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** 当前阶段的登录、注册、退出、当前账号和 CSRF JSON 接口。 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService authService;
    private final AuthenticationManager authenticationManager;
    private final AuthSessionService sessions;
    private final AuthCookieWriter cookieWriter;
    private final int avatarMaxBytes;
    private final InMemoryRateLimiter rateLimiter;

    public AuthController(
            AuthService authService,
            AuthenticationManager authenticationManager,
            AuthSessionService sessions,
            AuthCookieWriter cookieWriter,
            InMemoryRateLimiter rateLimiter,
            @Value("${airchord.auth.avatar-max-bytes:2097152}") int avatarMaxBytes
    ) {
        this.authService = authService;
        this.authenticationManager = authenticationManager;
        this.sessions = sessions;
        this.cookieWriter = cookieWriter;
        this.rateLimiter = rateLimiter;
        this.avatarMaxBytes = avatarMaxBytes;
    }

    @GetMapping("/csrf")
    public CsrfResponse csrf(CsrfToken csrfToken, HttpServletResponse response) {
        // token 本身存入 Redis session；Cookie 只作为现有客户端可选读取的镜像值。
        String token = csrfToken.getToken();
        cookieWriter.writeCsrfCookie(response, token);
        response.setHeader("Cache-Control", CacheControl.noStore().getHeaderValue());
        return new CsrfResponse(token);
    }

    @PostMapping("/login")
    public AuthUserResponse login(
            @Valid @RequestBody LoginRequest body,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        String username = authService.normalizeUsername(body.username());
        rateLimiter.checkLoginUsername(username, response);
        authService.validatePassword(body.password(), false);
        Authentication authentication = authenticate(username, body.password());
        sessions.establish(authentication, request, response);
        response.setHeader("Cache-Control", "no-store");
        return new AuthUserResponse(toAuthUser((AuthPrincipal) authentication.getPrincipal()));
    }

    @PostMapping("/register")
    public ResponseEntity<AuthUserResponse> register(
            @Valid @RequestBody RegisterRequest body,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        if (!authService.isRegistrationEnabled()) {
            throw new AuthException("AUTH_REGISTRATION_DISABLED", "公开注册未开启", 404);
        }
        AuthUserRecord created = authService.register(body.username(), body.password());
        Authentication authentication = authenticate(created.username(), body.password());
        sessions.establish(authentication, request, response);
        response.setHeader("Cache-Control", "no-store");
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new AuthUserResponse(toAuthUser((AuthPrincipal) authentication.getPrincipal())));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        sessions.invalidate(request, response);
        response.setHeader("Cache-Control", "no-store");
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    public AuthUserResponse currentUser(
            @AuthenticationPrincipal AuthPrincipal principal,
            HttpServletResponse response
    ) {
        response.setHeader("Cache-Control", "no-store");
        return new AuthUserResponse(toAuthUser(authService.requireEnabledUser(principal.id())));
    }

    @PutMapping("/me/avatar")
    public AuthUserResponse updateMyAvatar(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestParam("avatar") MultipartFile avatar,
            HttpServletResponse response
    ) throws IOException {
        if (avatar.isEmpty()) throw new AuthException("AUTH_INVALID_AVATAR", "头像文件不能为空", 400);
        if (avatar.getSize() > avatarMaxBytes) throw new AuthException("AUTH_AVATAR_TOO_LARGE", "头像文件过大", 413);
        byte[] data = avatar.getBytes();
        if (data.length == 0) throw new AuthException("AUTH_INVALID_AVATAR", "头像文件不能为空", 400);
        if (data.length > avatarMaxBytes) throw new AuthException("AUTH_AVATAR_TOO_LARGE", "头像文件过大", 413);
        String contentType = detectImageType(data);
        AuthUserRecord updated = authService.updateAvatar(principal.id(), data, contentType);
        response.setHeader("Cache-Control", "no-store");
        return new AuthUserResponse(toAuthUser(updated));
    }

    @DeleteMapping("/me/avatar")
    public AuthUserResponse deleteMyAvatar(
            @AuthenticationPrincipal AuthPrincipal principal,
            HttpServletResponse response
    ) {
        AuthUserRecord updated = authService.deleteAvatar(principal.id());
        response.setHeader("Cache-Control", "no-store");
        return new AuthUserResponse(toAuthUser(updated));
    }

    private Authentication authenticate(String username, String password) {
        try {
            return authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(username, password)
            );
        } catch (AuthenticationException exception) {
            // 不向客户端透露账号不存在、被禁用或密码错误之间的差异。
            throw new AuthException("AUTH_INVALID_CREDENTIALS", "用户名或密码错误", 401);
        }
    }

    private static AuthUser toAuthUser(AuthPrincipal principal) {
        return new AuthUser(principal.id(), principal.getUsername(), principal.role(), avatarUrl(principal.id(), principal.avatarUpdatedAt()));
    }

    private static AuthUser toAuthUser(AuthUserRecord user) {
        return new AuthUser(user.id(), user.username(), user.role(), avatarUrl(user.id(), user.avatarUpdatedAt()));
    }

    private static String avatarUrl(long userId, String updatedAt) {
        if (!StringUtils.hasText(updatedAt)) return null;
        String version = URLEncoder.encode(updatedAt, StandardCharsets.UTF_8).replace("+", "%20");
        return "/api/v1/users/" + userId + "/avatar?v=" + version;
    }

    private static String detectImageType(byte[] data) {
        if (startsWith(data, new byte[]{(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10})) return "image/png";
        if (startsWith(data, new byte[]{(byte) 0xff, (byte) 0xd8, (byte) 0xff})) return "image/jpeg";
        if (data.length >= 12
                && data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F'
                && data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P') {
            return "image/webp";
        }
        throw new AuthException("AUTH_INVALID_AVATAR", "仅支持 PNG、JPEG 和 WebP 头像", 400);
    }

    private static boolean startsWith(byte[] value, byte[] prefix) {
        if (value.length < prefix.length) return false;
        for (int index = 0; index < prefix.length; index++) {
            if (value[index] != prefix[index]) return false;
        }
        return true;
    }
}

package org.airchord.backend.auth;

import jakarta.validation.Valid;
import org.airchord.backend.auth.AdminUserDtos.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** 管理员账号及公开注册开关 API。角色授权由 SecurityFilterChain 统一执行。 */
@RestController
@RequestMapping("/api/v1/admin")
public class AdminUserController {
    private final AdminUserService service;
    private final int avatarMaxBytes;
    public AdminUserController(AdminUserService service,
                               @Value("${airchord.auth.avatar-max-bytes:2097152}") int avatarMaxBytes) {
        this.service = service;
        this.avatarMaxBytes = avatarMaxBytes;
    }

    @GetMapping("/users")
    public Page list(@RequestParam(required = false) String query, @RequestParam(required = false) String role,
                     @RequestParam(required = false) Boolean enabled, @RequestParam(defaultValue = "0") int page,
                     @RequestParam(defaultValue = "20") int size) {
        return service.list(query, role, enabled, page, size);
    }

    @PostMapping("/users")
    public ResponseEntity<User> create(@Valid @RequestBody CreateRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(body));
    }

    @PatchMapping("/users/{id}")
    public User update(@PathVariable long id, @AuthenticationPrincipal AuthPrincipal actor,
                       @Valid @RequestBody UpdateRequest body) {
        return service.update(id, actor.id(), body);
    }

    @PostMapping("/users/{id}/reset-password")
    public User resetPassword(@PathVariable long id, @Valid @RequestBody ResetPasswordRequest body) {
        return service.resetPassword(id, body.password());
    }

    @GetMapping("/settings/registration")
    public RegistrationResponse registration() { return service.registration(); }

    @PatchMapping("/settings/registration")
    public RegistrationResponse setRegistration(@Valid @RequestBody RegistrationRequest body) {
        return service.setRegistration(body.enabled());
    }

    @PutMapping("/users/{id}/avatar")
    public User updateAvatar(@PathVariable long id, @RequestParam("avatar") MultipartFile avatar) throws IOException {
        if (avatar.isEmpty() || avatar.getSize() > avatarMaxBytes) throw new org.airchord.backend.web.BackendApiException(
                avatar.isEmpty() ? "AUTH_INVALID_AVATAR" : "AUTH_AVATAR_TOO_LARGE", "头像文件无效或过大", avatar.isEmpty() ? 400 : 413);
        byte[] bytes = avatar.getBytes();
        if (bytes.length == 0 || bytes.length > avatarMaxBytes) throw new org.airchord.backend.web.BackendApiException(
                bytes.length == 0 ? "AUTH_INVALID_AVATAR" : "AUTH_AVATAR_TOO_LARGE", "头像文件无效或过大", bytes.length == 0 ? 400 : 413);
        String type = avatarType(bytes);
        return service.updateAvatar(id, bytes, type);
    }

    @DeleteMapping("/users/{id}/avatar")
    public User deleteAvatar(@PathVariable long id) { return service.deleteAvatar(id); }

    private static String avatarType(byte[] b) {
        if (b.length >= 8 && b[0] == (byte) 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return "image/png";
        if (b.length >= 3 && (b[0] & 255) == 255 && (b[1] & 255) == 216 && (b[2] & 255) == 255) return "image/jpeg";
        if (b.length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return "image/webp";
        throw new org.airchord.backend.web.BackendApiException("AUTH_INVALID_AVATAR", "仅支持 PNG、JPEG 和 WebP 头像", 400);
    }
}

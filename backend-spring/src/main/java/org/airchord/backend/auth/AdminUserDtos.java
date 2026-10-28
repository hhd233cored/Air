package org.airchord.backend.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

/** 管理 API 专用 DTO：只暴露用户资料，不返回密码哈希和头像二进制。 */
public final class AdminUserDtos {
    private AdminUserDtos() { }

    public record User(long id, String username, String role, boolean enabled, String avatarUrl, String createdAt, String updatedAt) { }
    public record Page(List<User> content, int page, int size, long totalElements, int totalPages) { }
    public record CreateRequest(
            @NotBlank @Size(max = 64) @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$") String username,
            @NotBlank @Size(min = 8, max = 256) String password,
            @Pattern(regexp = "(?i:USER|ADMIN)") String role,
            Boolean enabled
    ) { }
    public record UpdateRequest(@Pattern(regexp = "(?i:USER|ADMIN)") String role, Boolean enabled) { }
    public record ResetPasswordRequest(@NotBlank @Size(min = 8, max = 256) String password) { }
    public record RegistrationRequest(Boolean enabled) { }
    public record RegistrationResponse(boolean enabled) { }
}

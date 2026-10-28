package org.airchord.backend.auth;

import org.airchord.backend.auth.AdminUserDtos.*;
import org.airchord.backend.web.BackendApiException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** 管理员账号操作集中在 Service，确保最后管理员保护和数据库事务使用同一边界。 */
@Service
public class AdminUserService {
    private static final Logger LOGGER = LoggerFactory.getLogger(AdminUserService.class);
    private final AuthUserRepository users;
    private final PasswordEncoder passwords;
    private final FindByIndexNameSessionRepository<? extends Session> sessions;

    public AdminUserService(AuthUserRepository users, PasswordEncoder passwords,
                            FindByIndexNameSessionRepository<? extends Session> sessions) {
        this.users = users;
        this.passwords = passwords;
        this.sessions = sessions;
    }

    public Page list(String query, String role, Boolean enabled, int page, int size) {
        validatePage(page, size);
        if (query != null && query.length() > 64)
            throw new BackendApiException("BAD_REQUEST", "用户名筛选最多 64 个字符", 400);
        String normalizedRole = normalizeRole(role);
        var found = users.listAdminUsers(query, normalizedRole, enabled, page, size);
        return new Page(found.content().stream().map(AdminUserService::toDto).toList(), page, size,
                found.totalElements(), pages(found.totalElements(), size));
    }

    @Transactional
    public User create(CreateRequest request) {
        String username = normalizeUsername(request.username());
        validatePassword(request.password());
        try {
            String role = request.role() == null ? "USER" : normalizeRole(request.role());
            return toDto(users.createAdminUser(username, passwords.encode(request.password()),
                    role, request.enabled() == null || request.enabled()));
        } catch (DuplicateKeyException ex) {
            throw new BackendApiException("AUTH_USERNAME_TAKEN", "用户名已被注册", 409);
        }
    }

    @Transactional
    public User update(long id, long actorId, UpdateRequest request) {
        var current = requireUser(id);
        String role = normalizeRole(request.role());
        Boolean enabled = request.enabled();
        if (id == actorId && ("USER".equals(role) || Boolean.FALSE.equals(enabled))) {
            throw new BackendApiException("AUTH_SELF_PROTECTED", "不能降低或禁用当前管理员账号", 403);
        }
        boolean removesAdmin = "ADMIN".equals(current.role()) && current.enabled()
                && ("USER".equals(role) || Boolean.FALSE.equals(enabled));
        if (removesAdmin) {
            users.lockAdminChanges();
            if (users.countEnabledAdmins() <= 1) {
                throw new BackendApiException("AUTH_LAST_ADMIN", "至少需要一位启用的管理员", 409);
            }
        }
        users.updateRoleAndEnabled(id, role, enabled);
        if (role != null || enabled != null) invalidateSessions(current.username());
        return toDto(requireUser(id));
    }

    @Transactional
    public User resetPassword(long id, String password) {
        validatePassword(password);
        var current = requireUser(id);
        users.updatePassword(id, passwords.encode(password));
        invalidateSessions(current.username());
        return toDto(requireUser(id));
    }

    public RegistrationResponse registration() {
        return new RegistrationResponse(users.isRegistrationEnabled());
    }

    public User updateAvatar(long id, byte[] data, String contentType) {
        requireUser(id);
        users.updateAvatar(id, data, contentType);
        return toDto(requireUser(id));
    }

    public User deleteAvatar(long id) {
        requireUser(id);
        users.deleteAvatar(id);
        return toDto(requireUser(id));
    }

    public RegistrationResponse setRegistration(Boolean enabled) {
        if (enabled == null) throw new BackendApiException("BAD_REQUEST", "enabled 字段必填", 400);
        users.updateRegistrationSetting(enabled);
        return registration();
    }

    private AuthUserRepository.AdminUserRecord requireUser(long id) {
        var user = users.findAdminUser(id);
        if (user == null) throw new BackendApiException("AUTH_USER_NOT_FOUND", "用户不存在", 404);
        return user;
    }

    private void invalidateSessions(String username) {
        // 先提交数据库，再撤销 Redis session，避免事务回滚时误使有效用户退出。
        Runnable revoke = () -> {
            try { sessions.findByPrincipalName(username).keySet().forEach(sessions::deleteById); }
            catch (RuntimeException ex) {
                // security_version 会在后续认证请求中拒绝旧 session；这里记录 Redis 主动清理失败。
                LOGGER.error("无法通过 Redis 主体索引删除用户 session: {}", username, ex);
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { revoke.run(); }
            });
        } else revoke.run();
    }

    private static User toDto(AuthUserRepository.AdminUserRecord user) {
        String avatar = user.avatarUpdatedAt() == null ? null : "/api/v1/users/" + user.id() + "/avatar?v="
                + URLEncoder.encode(user.avatarUpdatedAt(), StandardCharsets.UTF_8).replace("+", "%20");
        return new User(user.id(), user.username(), user.role(), user.enabled(), avatar, user.createdAt(), user.updatedAt());
    }

    private static String normalizeUsername(String value) {
        String normalized = value == null ? "" : value.strip();
        if (!normalized.matches("^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$"))
            throw new BackendApiException("AUTH_INVALID_USERNAME", "用户名格式无效", 400);
        return normalized;
    }

    private static void validatePassword(String value) {
        if (value == null || value.length() < 8 || value.length() > 256)
            throw new BackendApiException("AUTH_WEAK_PASSWORD", "密码长度必须为 8 到 256 个字符", 400);
    }

    private static String normalizeRole(String value) {
        if (value == null) return null;
        String role = value.toUpperCase(Locale.ROOT);
        if (!role.equals("USER") && !role.equals("ADMIN"))
            throw new BackendApiException("AUTH_INVALID_ROLE", "用户角色无效", 400);
        return role;
    }

    private static int pages(long total, int size) { return total == 0 ? 0 : (int) ((total + size - 1) / size); }
    private static void validatePage(int page, int size) {
        if (page < 0 || size < 1 || size > 100) throw new BackendApiException("BAD_REQUEST", "分页参数无效", 400);
    }
}

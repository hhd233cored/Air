package org.airchord.backend.auth;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.regex.Pattern;

/** 账号规则与密码哈希；HTTP 状态码和 Cookie 由 Controller/Spring Security 负责。 */
@Service
public class AuthService {

    private static final Pattern USERNAME_PATTERN = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$");

    private final AuthUserRepository repository;
    private final PasswordEncoder passwordEncoder;

    public AuthService(AuthUserRepository repository, PasswordEncoder passwordEncoder) {
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
    }

    public String normalizeUsername(String username) {
        String normalized = username == null ? "" : username.strip();
        if (!USERNAME_PATTERN.matcher(normalized).matches()) {
            throw new AuthException("AUTH_INVALID_USERNAME", "用户名格式无效", 400);
        }
        return normalized;
    }

    public void validatePassword(String password, boolean registration) {
        int length = password == null ? 0 : password.length();
        if ((registration && length < 8) || length > 256 || (!registration && length < 1)) {
            throw new AuthException("AUTH_WEAK_PASSWORD", "密码长度无效", 400);
        }
    }

    @Transactional
    public AuthUserRecord register(String username, String password) {
        String normalizedUsername = normalizeUsername(username);
        validatePassword(password, true);
        try {
            return repository.insertUser(normalizedUsername, passwordEncoder.encode(password), "USER");
        } catch (DuplicateKeyException exception) {
            throw new AuthException("AUTH_USERNAME_TAKEN", "用户名已被注册", 409);
        }
    }

    public boolean isRegistrationEnabled() {
        return repository.isRegistrationEnabled();
    }

    public AuthUserRecord requireEnabledUser(long userId) {
        AuthUserRecord user = repository.findById(userId);
        if (user == null || !user.enabled()) {
            throw new AuthException("AUTH_REQUIRED", "Authentication is required", 401);
        }
        return user;
    }

    public AuthUserRecord updateAvatar(long userId, byte[] data, String contentType) {
        AuthUserRecord user = repository.updateAvatar(userId, data, contentType);
        if (user == null) throw new AuthException("AUTH_REQUIRED", "Authentication is required", 401);
        return user;
    }

    public AuthUserRecord deleteAvatar(long userId) {
        AuthUserRecord user = repository.deleteAvatar(userId);
        if (user == null) throw new AuthException("AUTH_REQUIRED", "Authentication is required", 401);
        return user;
    }

    public UserAvatar findAvatar(long userId) {
        return repository.findAvatar(userId);
    }

    /** 可选的本机引导账号只在首次创建时写入，不会覆盖既有密码或角色。 */
    public void ensureBootstrapUser(String username, String password, String role) {
        String normalizedUsername = normalizeUsername(username);
        validatePassword(password, true);
        if (repository.findByUsername(normalizedUsername) != null) return;
        try {
            repository.insertUser(normalizedUsername, passwordEncoder.encode(password), role);
        } catch (DuplicateKeyException exception) {
            // 多个服务实例同时启动时，用户名唯一约束负责仲裁；已有账号不被重写。
            if (repository.findByUsername(normalizedUsername) == null) throw exception;
        }
    }
}

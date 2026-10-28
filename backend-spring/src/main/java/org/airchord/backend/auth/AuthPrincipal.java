package org.airchord.backend.auth;

import org.springframework.security.core.CredentialsContainer;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.io.Serial;
import java.io.Serializable;
import java.util.Collection;
import java.util.List;

/**
 * 放入 Redis session 的最小身份信息。
 * 实现 Serializable 是因为 Spring Session 默认会序列化 HttpSession 属性；认证成功后会清除密码哈希。
 */
public final class AuthPrincipal implements UserDetails, CredentialsContainer, Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    private final long id;
    private final String username;
    private final String role;
    private final boolean enabled;
    private final String avatarUpdatedAt;
    private final long securityVersion;
    private String passwordHash;

    public AuthPrincipal(AuthUserRecord user) {
        this.id = user.id();
        this.username = user.username();
        this.role = user.role();
        this.enabled = user.enabled();
        this.avatarUpdatedAt = user.avatarUpdatedAt();
        this.securityVersion = user.securityVersion();
        this.passwordHash = user.passwordHash();
    }

    public long id() {
        return id;
    }

    public String role() {
        return role;
    }

    public String avatarUpdatedAt() {
        return avatarUpdatedAt;
    }

    public long securityVersion() { return securityVersion; }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority("ROLE_" + role));
    }

    @Override
    public String getPassword() {
        return passwordHash;
    }

    @Override
    public String getUsername() {
        return username;
    }

    @Override
    public boolean isEnabled() {
        return enabled;
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public void eraseCredentials() {
        passwordHash = null;
    }
}

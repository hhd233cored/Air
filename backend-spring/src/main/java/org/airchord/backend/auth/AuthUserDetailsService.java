package org.airchord.backend.auth;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

/** 登录时由 Spring Security 调用，按用户名从 PostgreSQL 加载账号与 Argon2id 哈希。 */
@Service
public class AuthUserDetailsService implements UserDetailsService {

    private final AuthUserRepository repository;

    public AuthUserDetailsService(AuthUserRepository repository) {
        this.repository = repository;
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        AuthUserRecord user = repository.findByUsername(username);
        if (user == null) throw new UsernameNotFoundException("User not found");
        return new AuthPrincipal(user);
    }
}

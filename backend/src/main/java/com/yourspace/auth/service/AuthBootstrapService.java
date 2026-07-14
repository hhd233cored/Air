package com.yourspace.auth.service;

import com.yourspace.auth.entity.BlogUser;
import com.yourspace.auth.entity.UserRole;
import com.yourspace.auth.repository.BlogUserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;

@Service
public class AuthBootstrapService {
    private static final Logger log = LoggerFactory.getLogger(AuthBootstrapService.class);

    private final BlogUserRepository repository;
    private final PasswordEncoder passwordEncoder;
    private final String adminUsername;
    private final String adminPassword;
    private final String userUsername;
    private final String userPassword;

    public AuthBootstrapService(
            BlogUserRepository repository,
            PasswordEncoder passwordEncoder,
            @Value("${app.auth.admin-username:}") String adminUsername,
            @Value("${app.auth.admin-password:}") String adminPassword,
            @Value("${app.auth.user-username:}") String userUsername,
            @Value("${app.auth.user-password:}") String userPassword
    ) {
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
        this.adminUsername = adminUsername;
        this.adminPassword = adminPassword;
        this.userUsername = userUsername;
        this.userPassword = userPassword;
    }

    @EventListener(ApplicationReadyEvent.class)
    @Transactional
    public void initializeUsers() {
        createIfConfigured(adminUsername, adminPassword, UserRole.ADMIN);
        createIfConfigured(userUsername, userPassword, UserRole.USER);
    }

    private void createIfConfigured(String username, String password, UserRole role) {
        if (username == null || username.isBlank() || password == null || password.isBlank()) {
            if (role == UserRole.ADMIN) {
                log.warn("{} account was not bootstrapped because AUTH_ADMIN_USERNAME/AUTH_ADMIN_PASSWORD is not configured", role);
            }
            return;
        }

        String normalizedUsername = username.trim().toLowerCase(Locale.ROOT);
        if (repository.existsByUsername(normalizedUsername)) return;

        repository.save(new BlogUser(normalizedUsername, passwordEncoder.encode(password), role));
        log.info("Bootstrapped {} account '{}'", role, normalizedUsername);
    }
}

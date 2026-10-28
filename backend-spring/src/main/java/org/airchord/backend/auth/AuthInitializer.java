package org.airchord.backend.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/** Flyway 完成后初始化注册开关，并按需建立本机引导账号。 */
@Component
public class AuthInitializer implements ApplicationRunner {

    private final AuthUserRepository repository;
    private final AuthService authService;
    private final boolean registrationEnabled;
    private final String adminUsername;
    private final String adminPassword;
    private final String userUsername;
    private final String userPassword;

    public AuthInitializer(
            AuthUserRepository repository,
            AuthService authService,
            @Value("${airchord.auth.registration-enabled:true}") boolean registrationEnabled,
            @Value("${airchord.auth.bootstrap-admin-username:}") String adminUsername,
            @Value("${airchord.auth.bootstrap-admin-password:}") String adminPassword,
            @Value("${airchord.auth.bootstrap-user-username:}") String userUsername,
            @Value("${airchord.auth.bootstrap-user-password:}") String userPassword
    ) {
        this.repository = repository;
        this.authService = authService;
        this.registrationEnabled = registrationEnabled;
        this.adminUsername = adminUsername;
        this.adminPassword = adminPassword;
        this.userUsername = userUsername;
        this.userPassword = userPassword;
    }

    @Override
    public void run(ApplicationArguments args) {
        repository.initializeRegistrationSetting(registrationEnabled);
        ensureOptionalAccount(adminUsername, adminPassword, "ADMIN");
        ensureOptionalAccount(userUsername, userPassword, "USER");
    }

    private void ensureOptionalAccount(String username, String password, String role) {
        boolean usernameProvided = username != null && !username.isBlank();
        boolean passwordProvided = password != null && !password.isBlank();
        if (!usernameProvided && !passwordProvided) return;
        if (!usernameProvided || !passwordProvided) {
            throw new IllegalStateException("AUTH_" + role + "_USERNAME 与 AUTH_" + role + "_PASSWORD 必须同时设置");
        }
        authService.ensureBootstrapUser(username, password, role);
    }
}

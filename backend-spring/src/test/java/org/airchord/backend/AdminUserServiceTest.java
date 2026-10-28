package org.airchord.backend;

import org.airchord.backend.auth.AdminUserDtos.UpdateRequest;
import org.airchord.backend.auth.AdminUserService;
import org.airchord.backend.auth.AuthUserRepository;
import org.airchord.backend.web.BackendApiException;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.session.FindByIndexNameSessionRepository;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

/** 管理员安全边界无需数据库即可测试；SQL 行锁和计数由集成测试验证。 */
class AdminUserServiceTest {
    @Test
    @SuppressWarnings("unchecked")
    void cannotDemoteTheLastEnabledAdmin() {
        AuthUserRepository users = mock(AuthUserRepository.class);
        PasswordEncoder passwords = mock(PasswordEncoder.class);
        FindByIndexNameSessionRepository<?> sessions = mock(FindByIndexNameSessionRepository.class);
        when(users.findAdminUser(42)).thenReturn(new AuthUserRepository.AdminUserRecord(
                42, "owner", "ADMIN", true, null, "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"));
        when(users.countEnabledAdmins()).thenReturn(1L);
        AdminUserService service = new AdminUserService(users, passwords, sessions);

        assertThatThrownBy(() -> service.update(42, 99, new UpdateRequest("USER", null)))
                .isInstanceOf(BackendApiException.class)
                .satisfies(error -> {
                    BackendApiException apiError = (BackendApiException) error;
                    org.assertj.core.api.Assertions.assertThat(apiError.code()).isEqualTo("AUTH_LAST_ADMIN");
                    org.assertj.core.api.Assertions.assertThat(apiError.statusCode()).isEqualTo(409);
                });
        verify(users).lockAdminChanges();
        verify(users, never()).updateRoleAndEnabled(anyLong(), any(), any());
    }
}

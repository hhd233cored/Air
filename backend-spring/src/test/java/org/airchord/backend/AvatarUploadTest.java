package org.airchord.backend;

import org.airchord.backend.auth.*;
import org.airchord.backend.web.BackendApiException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.multipart.MultipartFile;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class AvatarUploadTest {
    @Test
    void oversizedUploadsAreRejectedBeforeReadingTheirBytes() throws Exception {
        MultipartFile upload = mock(MultipartFile.class);
        when(upload.getSize()).thenReturn(100 * 1024 * 1024L);
        AuthService auth = mock(AuthService.class);
        AdminUserService admin = mock(AdminUserService.class);
        AuthController controller = new AuthController(auth, null, null, null, null, 2 * 1024 * 1024);
        AdminUserController adminController = new AdminUserController(admin, 2 * 1024 * 1024);

        assertThatThrownBy(() -> controller.updateMyAvatar(null, upload, new MockHttpServletResponse()))
                .isInstanceOf(AuthException.class).extracting("statusCode").isEqualTo(413);
        assertThatThrownBy(() -> adminController.updateAvatar(1, upload))
                .isInstanceOf(BackendApiException.class).extracting("statusCode").isEqualTo(413);
        verify(upload, never()).getBytes();
        verifyNoInteractions(auth, admin);
    }

    @Test
    void emptyUploadsAreRejectedBeforeReadingTheirBytes() throws Exception {
        MultipartFile upload = mock(MultipartFile.class);
        when(upload.isEmpty()).thenReturn(true);
        AuthController controller = new AuthController(null, null, null, null, null, 1024);
        assertThatThrownBy(() -> controller.updateMyAvatar(null, upload, new MockHttpServletResponse()))
                .isInstanceOf(AuthException.class).extracting("statusCode").isEqualTo(400);
        assertThatThrownBy(() -> new AdminUserController(null, 1024).updateAvatar(1, upload))
                .isInstanceOf(BackendApiException.class).extracting("statusCode").isEqualTo(400);
        verify(upload, never()).getBytes();
    }
}

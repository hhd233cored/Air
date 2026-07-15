package com.yourspace.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AuthSecurityIntegrationTest {
    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void publicArticlesRemainReadableAndMeRequiresLogin() throws Exception {
        mockMvc.perform(get("/api/v1/health")).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/articles")).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
    }

    @Test
    void invalidCredentialsAreRejected() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginPayload("admin", "wrong-password"))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_INVALID_CREDENTIALS"));
    }

    @Test
    void adminCanLoginCreateArticleAndLogout() throws Exception {
        MockHttpSession session = login("admin", "admin-password");

        mockMvc.perform(get("/api/v1/admin/articles").session(session))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/articles")
                        .session(session)
                        .with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"slug":"auth-test-article","title":"Auth test article","contentMarkdown":"# Test","tags":["test"]}
                                """))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/v1/auth/logout")
                        .session(session)
                        .with(SecurityMockMvcRequestPostProcessors.csrf()))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/auth/me").session(session))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void normalUserCannotWriteArticles() throws Exception {
        MockHttpSession session = login("reader", "reader-password");

        mockMvc.perform(post("/api/v1/articles")
                        .session(session)
                        .with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"slug":"reader-article","title":"Reader article","contentMarkdown":"# Test"}
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("AUTH_FORBIDDEN"));
    }

    @Test
    void writeWithoutCsrfTokenIsRejected() throws Exception {
        mockMvc.perform(post("/api/v1/articles")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"slug":"csrf-article","title":"CSRF article","contentMarkdown":"# Test"}
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_INVALID"));
    }

    private MockHttpSession login(String username, String password) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                .with(SecurityMockMvcRequestPostProcessors.csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginPayload(username, password))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.username").value(username))
                .andReturn();
        return (MockHttpSession) result.getRequest().getSession(false);
    }

    private record LoginPayload(String username, String password) {
    }
}

package org.airchord.backend.auth;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
        @NotNull @Size(min = 1, max = 64) String username,
        @NotNull @Size(min = 8, max = 256) String password
) {
}

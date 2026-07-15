package com.yourspace.auth.dto;

import com.yourspace.auth.entity.BlogUser;
import com.yourspace.auth.entity.UserRole;

import java.util.UUID;

public record UserResponse(UUID id, String username, UserRole role) {
    public static UserResponse from(BlogUser user) {
        return new UserResponse(user.getId(), user.getUsername(), user.getRole());
    }
}

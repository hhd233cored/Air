package com.yourspace.auth.repository;

import com.yourspace.auth.entity.BlogUser;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface BlogUserRepository extends JpaRepository<BlogUser, UUID> {
    Optional<BlogUser> findByUsername(String username);

    boolean existsByUsername(String username);
}

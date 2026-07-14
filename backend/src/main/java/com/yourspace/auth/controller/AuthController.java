package com.yourspace.auth.controller;

import com.yourspace.auth.dto.AuthResponse;
import com.yourspace.auth.dto.CsrfResponse;
import com.yourspace.auth.dto.LoginRequest;
import com.yourspace.auth.dto.UserResponse;
import com.yourspace.auth.repository.BlogUserRepository;
import com.yourspace.auth.service.InvalidCredentialsException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.AuthenticationServiceException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final AuthenticationManager authenticationManager;
    private final SecurityContextRepository securityContextRepository;
    private final BlogUserRepository userRepository;

    public AuthController(AuthenticationManager authenticationManager, SecurityContextRepository securityContextRepository, BlogUserRepository userRepository) {
        this.authenticationManager = authenticationManager;
        this.securityContextRepository = securityContextRepository;
        this.userRepository = userRepository;
    }

    @GetMapping("/csrf")
    public CsrfResponse csrf(CsrfToken token) {
        return new CsrfResponse(token.getToken());
    }

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest request, HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        Authentication authentication;
        try {
            authentication = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(request.username(), request.password())
            );
        } catch (AuthenticationException exception) {
            throw new InvalidCredentialsException();
        }

        httpRequest.getSession(true);
        httpRequest.changeSessionId();
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        securityContextRepository.saveContext(context, httpRequest, httpResponse);

        return userRepository.findByUsername(authentication.getName())
                .map(user -> new AuthResponse(UserResponse.from(user)))
                .orElseThrow(() -> new AuthenticationServiceException("Authenticated user no longer exists"));
    }

    @GetMapping("/me")
    public AuthResponse me(Authentication authentication) {
        return userRepository.findByUsername(authentication.getName())
                .map(user -> new AuthResponse(UserResponse.from(user)))
                .orElseThrow(() -> new AuthenticationServiceException("Authenticated user no longer exists"));
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest request, HttpServletResponse response, Authentication authentication) {
        new SecurityContextLogoutHandler().logout(request, response, authentication);
    }
}

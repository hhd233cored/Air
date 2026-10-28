package org.airchord.backend.auth;

import jakarta.servlet.DispatcherType;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CsrfFilter;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.session.web.http.DefaultCookieSerializer;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.time.Duration;
import java.util.Arrays;
import java.util.List;

/** Cookie session、Redis 持久化、CSRF、CORS 與默认拒绝授权策略集中在此处。 */
@Configuration
@EnableMethodSecurity
public class AuthSecurityConfiguration {

    @Bean
    PasswordEncoder passwordEncoder() {
        // PHC Argon2id 格式可验证 pwdlib 生成的 Argon2id 哈希；新注册账号也用 Argon2id。
        return Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
    }

    @Bean
    AuthenticationManager authenticationManager(AuthUserDetailsService userDetailsService, PasswordEncoder encoder) {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider(userDetailsService);
        provider.setPasswordEncoder(encoder);
        // ProviderManager 在认证完成后擦除 UserDetails 中的密码哈希，避免其进入 Redis session。
        return new ProviderManager(List.of(provider));
    }

    @Bean
    SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    CsrfTokenRepository csrfTokenRepository() {
        HttpSessionCsrfTokenRepository repository = new HttpSessionCsrfTokenRepository();
        repository.setSessionAttributeName("airchord.security.csrf-token");
        repository.setHeaderName("X-XSRF-TOKEN");
        return repository;
    }

    @Bean
    CookieSerializer cookieSerializer(
            @Value("${airchord.auth.cookie-name:air_session}") String cookieName,
            @Value("${airchord.auth.cookie-secure:false}") boolean secure,
            @Value("${airchord.auth.cookie-same-site:Lax}") String sameSite,
            @Value("${airchord.auth.session-timeout:7d}") Duration sessionTimeout
    ) {
        DefaultCookieSerializer serializer = new DefaultCookieSerializer();
        serializer.setCookieName(cookieName);
        serializer.setCookiePath("/");
        serializer.setUseHttpOnlyCookie(true);
        serializer.setUseSecureCookie(secure);
        serializer.setSameSite(sameSite);
        serializer.setCookieMaxAge(Math.toIntExact(sessionTimeout.toSeconds()));
        return serializer;
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @Value("${airchord.cors.allowed-origins:http://localhost:3000,http://127.0.0.1:3000}") String configuredOrigins
    ) {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(Arrays.stream(configuredOrigins.split(","))
                .map(String::strip)
                .filter(origin -> !origin.isEmpty())
                .toList());
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Accept", "Content-Type", "X-XSRF-TOKEN", "Idempotency-Key"));
        configuration.setExposedHeaders(List.of("Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            CsrfTokenRepository csrfTokenRepository,
            SecurityContextRepository securityContextRepository,
            AuthenticationManager authenticationManager,
            ApiSecurityHandlers securityHandlers,
            AuthSessionValidationFilter sessionValidationFilter
    ) throws Exception {
        http
                .authenticationManager(authenticationManager)
                .cors(Customizer.withDefaults())
                // 使用 session-backed token：CsrfToken 和 SecurityContext 一起由 Spring Session 写进 Redis。
                .csrf(csrf -> csrf.csrfTokenRepository(csrfTokenRepository))
                .securityContext(context -> context
                        .securityContextRepository(securityContextRepository)
                        .requireExplicitSave(true))
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED)
                        .sessionFixation(sessionFixation -> sessionFixation.changeSessionId()))
                .exceptionHandling(errors -> errors
                        .authenticationEntryPoint(securityHandlers)
                        .accessDeniedHandler(securityHandlers))
                .authorizeHttpRequests(auth -> auth
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers(HttpMethod.GET,
                                "/api/v1/health",
                                "/api/v1/articles", "/api/v1/articles/**",
                                "/api/v1/chatter", "/api/v1/chatter/**",
                                "/api/v1/search",
                                "/api/v1/guestbook/messages",
                                "/api/v1/music/**",
                                "/api/v1/users/*/avatar",
                                "/articles/**", "/chatter/**", "/music/**")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/auth/csrf").permitAll()
                        // 匿名阅读也可上报一次页面展示；写请求仍由 CSRF 过滤器校验。
                        .requestMatchers(HttpMethod.POST, "/api/v1/articles/*/views").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/login", "/api/v1/auth/register").permitAll()
                        .requestMatchers("/api/v1/admin/**", "/api/v1/editor/**").hasRole("ADMIN")
                        .anyRequest().authenticated())
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .addFilterAfter(sessionValidationFilter, CsrfFilter.class);
        return http.build();
    }

    /** 该 Filter 只在 Spring Security 链内执行，避免被 Servlet 容器提前执行一次。 */
    @Bean
    FilterRegistrationBean<AuthSessionValidationFilter> disableContainerFilterRegistration(
            AuthSessionValidationFilter filter
    ) {
        FilterRegistrationBean<AuthSessionValidationFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }
}

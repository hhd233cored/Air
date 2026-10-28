package org.airchord.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * AirChord Java 后端的启动入口。
 * Spring Boot 会从当前包开始扫描 Controller、Repository 等组件，并装配 Web 与 JDBC 基础设施。
 */
@SpringBootApplication
@EnableScheduling
public class AirChordSpringApplication {

    public static void main(String[] args) {
        SpringApplication.run(AirChordSpringApplication.class, args);
    }
}

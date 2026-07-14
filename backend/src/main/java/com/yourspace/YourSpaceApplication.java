package com.yourspace;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class YourSpaceApplication {
    public static void main(String[] args) {
        SpringApplication.run(YourSpaceApplication.class, args);
    }
}

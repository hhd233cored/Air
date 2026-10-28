package org.airchord.backend.health;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 固定现有前端使用的健康检查契约。
 * 阶段 0 不在此接口泄漏数据库地址、版本或样例数据；数据库连接由启动迁移与集成测试单独验证。
 */
@RestController
@RequestMapping("/api/v1")
public class HealthController {

    @GetMapping("/health")
    public HealthResponse health() {
        return new HealthResponse("UP");
    }
}

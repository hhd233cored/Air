package org.airchord.backend.health;

/**
 * 健康接口的 JSON 响应。
 * 使用 record 让响应字段与构造参数一一对应，Jackson 会序列化为 {"status":"UP"}。
 */
public record HealthResponse(String status) {
}

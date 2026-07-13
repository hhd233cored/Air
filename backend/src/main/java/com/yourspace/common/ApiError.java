package com.yourspace.common;

import java.time.Instant;
import java.util.Map;

public record ApiError(String code, String message, Instant timestamp, String path, Map<String, String> details) {
}

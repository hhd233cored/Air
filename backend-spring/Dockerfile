# 构建阶段：在容器内用项目自带的 Maven Wrapper 编译 Java 21 应用。
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace

# .dockerignore 会排除本机凭据、Git 元数据和已编译产物。
COPY . .
# Windows checkouts may give mvnw CRLF endings, which break its /bin/sh shebang.
RUN sed -i 's/\r$//' ./mvnw \
    && chmod +x ./mvnw \
    && ./mvnw --batch-mode --no-transfer-progress -Dmaven.test.skip=true package

# 运行阶段只保留 JRE 与可执行 jar，并使用非 root 用户。
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build --chown=10001:10001 /workspace/target/airchord-backend-0.1.0-SNAPSHOT.jar /app/app.jar
# Docker 具名卷首次挂载时沿用镜像目录权限，让非 root JVM 可写私有暂存文件。
RUN mkdir -p /app/import-staging && chown 10001:10001 /app/import-staging
USER 10001:10001

EXPOSE 8081
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]

package org.airchord.backend.metrics;

import jakarta.servlet.ServletException;
import org.apache.catalina.connector.Request;
import org.apache.catalina.connector.Response;
import org.apache.catalina.valves.ValveBase;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import java.io.IOException;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "airchord.perf-timing-enabled", havingValue = "true")
class ArticleMetricPerfTomcatConfiguration {
    private volatile org.apache.coyote.AbstractProtocol<?> protocol;
    static final String PARSE_START = ArticleMetricPerfTomcatConfiguration.class.getName() + ".parseStart";
    @Bean WebServerFactoryCustomizer<TomcatServletWebServerFactory> metricTomcatTiming() {
        return factory -> {
            factory.addEngineValves(new TimingValve());
            factory.addConnectorCustomizers(connector -> {
                if (connector.getProtocolHandler() instanceof org.apache.coyote.AbstractProtocol<?> handler) {
                    protocol = handler;
                }
            });
        };
    }
    ThreadSnapshot threads() {
        var handler = protocol;
        if (handler == null) return null;
        var executor = handler.getExecutor();
        if (executor instanceof org.apache.tomcat.util.threads.ThreadPoolExecutor pool) {
            return new ThreadSnapshot(pool.getActiveCount(),pool.getPoolSize(),pool.getMaximumPoolSize(),pool.getQueue().size());
        }
        if (executor instanceof java.util.concurrent.ThreadPoolExecutor pool) {
            return new ThreadSnapshot(pool.getActiveCount(),pool.getPoolSize(),pool.getMaximumPoolSize(),pool.getQueue().size());
        }
        return null;
    }
    record ThreadSnapshot(int active,int size,int maximum,int queued) {}
    static final class TimingValve extends ValveBase {
        TimingValve() { super(true); }
        @Override public void invoke(Request request, Response response) throws IOException, ServletException {
            if ("1".equals(request.getHeader("X-Perf-Timing"))) {
                long started = request.getCoyoteRequest().getStartTimeNanos();
                if (started != -1) request.setAttribute(PARSE_START, started);
            }
            getNext().invoke(request, response);
        }
    }
}

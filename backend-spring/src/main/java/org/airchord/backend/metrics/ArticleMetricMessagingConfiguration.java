package org.airchord.backend.metrics;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.AcknowledgeMode;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Map;

/** 文章指标与容量 20 的音频队列完全分离，避免一个业务堵住另一个。 */
@Configuration(proxyBeanMethods = false)
public class ArticleMetricMessagingConfiguration {
    public static final String EXCHANGE = "airchord.article.metrics";
    public static final String ROUTING_KEY = "article.metrics";
    public static final String QUEUE = "airchord.article.metrics.q";
    private static final String DEAD_EXCHANGE = "airchord.article.metrics.dlx";

    @Bean DirectExchange articleMetricExchange() { return new DirectExchange(EXCHANGE, true, false); }
    @Bean DirectExchange articleMetricDeadExchange() { return new DirectExchange(DEAD_EXCHANGE, true, false); }
    @Bean Queue articleMetricQueue() {
        return new Queue(QUEUE, true, false, false, Map.of(
                "x-max-length", 20000, "x-overflow", "reject-publish",
                "x-dead-letter-exchange", DEAD_EXCHANGE,
                "x-dead-letter-routing-key", ROUTING_KEY));
    }
    @Bean Queue articleMetricDeadQueue() { return new Queue("airchord.article.metrics.dlq", true); }
    @Bean Binding articleMetricBinding(@Qualifier("articleMetricQueue") Queue queue,
                                       @Qualifier("articleMetricExchange") DirectExchange exchange) {
        return BindingBuilder.bind(queue).to(exchange).with(ROUTING_KEY);
    }
    @Bean Binding articleMetricDeadBinding(@Qualifier("articleMetricDeadQueue") Queue queue,
                                           @Qualifier("articleMetricDeadExchange") DirectExchange exchange) {
        return BindingBuilder.bind(queue).to(exchange).with(ROUTING_KEY);
    }

    @Bean SimpleRabbitListenerContainerFactory articleMetricListenerFactory(ConnectionFactory connectionFactory,
            @Value("${airchord.article-metric.consumer-batch-size:100}") int batchSize,
            @Value("${airchord.article-metric.consumer-batch-wait-ms:100}") long batchWaitMs) {
        if (batchSize < 1 || batchSize > 200 || batchWaitMs < 1 || batchWaitMs > 1000)
            throw new IllegalArgumentException("Article metric batch size must be 1..200; wait must be 1..1000 ms");
        var factory = new SimpleRabbitListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        factory.setAcknowledgeMode(AcknowledgeMode.MANUAL);
        factory.setConcurrentConsumers(1);
        factory.setMaxConcurrentConsumers(1);
        factory.setPrefetchCount(batchSize);
        factory.setBatchListener(true);
        factory.setConsumerBatchEnabled(true);
        // consumerBatchEnabled 会在初始化时自动开启生产者拆包，Consumer 检查重复 tag。
        factory.setBatchSize(batchSize);
        factory.setReceiveTimeout(batchWaitMs);
        factory.setBatchReceiveTimeout(batchWaitMs);
        return factory;
    }
}

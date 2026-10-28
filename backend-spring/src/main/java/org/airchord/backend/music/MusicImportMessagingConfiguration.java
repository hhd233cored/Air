package org.airchord.backend.music;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Qualifier;

import java.util.Map;

/** 声明持久化工作队列和死信队列；满队列拒绝发布，不丢弃旧任务。 */
@Configuration(proxyBeanMethods = false)
public class MusicImportMessagingConfiguration {
    public static final String EXCHANGE = "airchord.music.import";
    public static final String ROUTING_KEY = "music.import";
    public static final String WORK_QUEUE = "airchord.music.import.q";
    private static final String DEAD_EXCHANGE = "airchord.music.import.dlx";
    private static final String DEAD_QUEUE = "airchord.music.import.dlq";

    @Bean DirectExchange musicImportExchange() { return new DirectExchange(EXCHANGE, true, false); }
    @Bean DirectExchange musicImportDeadExchange() { return new DirectExchange(DEAD_EXCHANGE, true, false); }
    @Bean Queue musicImportQueue() {
        return new Queue(WORK_QUEUE, true, false, false, Map.of(
                "x-max-length", 20, "x-overflow", "reject-publish",
                "x-dead-letter-exchange", DEAD_EXCHANGE,
                "x-dead-letter-routing-key", ROUTING_KEY));
    }
    @Bean Queue musicImportDeadQueue() { return new Queue(DEAD_QUEUE, true); }
    @Bean Binding musicImportBinding(@Qualifier("musicImportQueue") Queue musicImportQueue,
                                     @Qualifier("musicImportExchange") DirectExchange musicImportExchange) {
        return BindingBuilder.bind(musicImportQueue).to(musicImportExchange).with(ROUTING_KEY);
    }
    @Bean Binding musicImportDeadBinding(@Qualifier("musicImportDeadQueue") Queue musicImportDeadQueue,
                                         @Qualifier("musicImportDeadExchange") DirectExchange musicImportDeadExchange) {
        return BindingBuilder.bind(musicImportDeadQueue).to(musicImportDeadExchange).with(ROUTING_KEY);
    }
}

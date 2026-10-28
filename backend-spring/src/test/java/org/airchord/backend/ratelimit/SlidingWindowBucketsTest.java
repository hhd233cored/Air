package org.airchord.backend.ratelimit;

import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import static org.assertj.core.api.Assertions.assertThat;

class SlidingWindowBucketsTest {
    @Test
    void expiresIdleBucketsAndRetainsLongerWindows() {
        AtomicLong now = new AtomicLong();
        SlidingWindowBuckets buckets = new SlidingWindowBuckets(2, now::get);
        buckets.check("short", 1, 10);
        buckets.check("long", 1, 100);
        now.set(10);
        buckets.cleanUp();
        assertThat(buckets.size()).isEqualTo(1);
        assertThat(buckets.check("long", 1, 100).limited()).isTrue();
        assertThat(buckets.check("new", 1, 10).limited()).isFalse();
        now.set(100);
        buckets.cleanUp();
        assertThat(buckets.size()).isZero();
    }

    @Test
    void capacityDoesNotEvictActiveCountersAndWindowRemainsSliding() {
        AtomicLong now = new AtomicLong();
        SlidingWindowBuckets buckets = new SlidingWindowBuckets(1, now::get);
        assertThat(buckets.check("user", 2, 10).limited()).isFalse();
        now.set(5);
        assertThat(buckets.check("user", 2, 10).limited()).isFalse();
        assertThat(buckets.check("other", 2, 10).limited()).isTrue();
        assertThat(buckets.check("user", 2, 10).limited()).isTrue();
        now.set(10);
        assertThat(buckets.check("user", 2, 10).remaining()).isZero();
        assertThat(buckets.check("user", 2, 10).limited()).isTrue();
        assertThat(buckets.size()).isEqualTo(1);
    }

    @Test
    void concurrentChecksAndCleanupCannotLoseCountsOrExceedCapacity() throws Exception {
        SlidingWindowBuckets buckets = new SlidingWindowBuckets(10, () -> 0L);
        try (var executor = Executors.newFixedThreadPool(12)) {
            var start = new CountDownLatch(1);
            var results = new ArrayList<Future<Boolean>>();
            for (int i = 0; i < 200; i++) results.add(executor.submit(() -> {
                start.await();
                buckets.cleanUp();
                return !buckets.check("same", 20, 100).limited();
            }));
            start.countDown();
            int allowed = 0;
            for (var result : results) if (result.get(10, TimeUnit.SECONDS)) allowed++;
            assertThat(allowed).isEqualTo(20);
            var unique = new ArrayList<Future<?>>();
            for (int i = 0; i < 100; i++) {
                String key = "key-" + i;
                unique.add(executor.submit(() -> buckets.check(key, 1, 100)));
            }
            for (var result : unique) result.get(10, TimeUnit.SECONDS);
            assertThat(buckets.size()).isEqualTo(10);
            assertThat(buckets.check("same", 20, 100).limited()).isTrue();
        }
    }
}

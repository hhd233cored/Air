package org.airchord.backend.ratelimit;

import java.util.ArrayDeque;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeSet;
import java.util.function.LongSupplier;

/** 有界滑动窗口。计数、过期和容量判断在同一短临界区完成，避免删除仍被请求使用的桶。 */
final class SlidingWindowBuckets {
    private final Map<String, Bucket> buckets = new HashMap<>();
    private final TreeSet<Bucket> expiry = new TreeSet<>(Comparator
            .comparingLong((Bucket bucket) -> bucket.expiresAt).thenComparing(bucket -> bucket.key));
    private final int capacity;
    private final LongSupplier clock;

    SlidingWindowBuckets(int capacity, LongSupplier clock) {
        this.capacity = capacity;
        this.clock = clock;
    }

    synchronized Result check(String key, int limit, long window) {
        long now = clock.getAsLong();
        removeExpired(now);
        Bucket bucket = buckets.get(key);
        if (bucket == null) {
            // 容量用尽时不淘汰活跃计数，否则可以通过制造新 key 绕过现有窗口。
            if (buckets.size() >= capacity) return new Result(0, seconds(expiry.first().expiresAt - now), true);
            bucket = new Bucket(key);
            buckets.put(key, bucket);
        }
        while (!bucket.events.isEmpty() && bucket.events.peekFirst() <= now - window) bucket.events.removeFirst();
        if (bucket.events.size() >= limit) {
            return new Result(0, seconds(window - (now - bucket.events.peekFirst())), true);
        }
        expiry.remove(bucket);
        bucket.events.addLast(now);
        bucket.expiresAt = now + window;
        expiry.add(bucket);
        return new Result(limit - bucket.events.size(), seconds(window - (now - bucket.events.peekFirst())), false);
    }

    synchronized void cleanUp() { removeExpired(clock.getAsLong()); }

    private void removeExpired(long now) {
        while (!expiry.isEmpty() && expiry.first().expiresAt <= now) {
            Bucket bucket = expiry.pollFirst();
            buckets.remove(bucket.key);
        }
    }

    synchronized int size() { return buckets.size(); }

    private static long seconds(long nanos) { return Math.max(1, (long) Math.ceil(nanos / 1_000_000_000d)); }

    record Result(int remaining, long resetSeconds, boolean limited) { }

    private static final class Bucket {
        private final String key;
        private final ArrayDeque<Long> events = new ArrayDeque<>();
        private long expiresAt;

        private Bucket(String key) { this.key = key; }
    }
}

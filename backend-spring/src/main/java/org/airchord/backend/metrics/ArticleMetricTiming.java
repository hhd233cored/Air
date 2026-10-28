package org.airchord.backend.metrics;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.Locale;
import java.util.LinkedHashMap;
import java.util.Map;

/** 仅在隔离压测显式开启时记录当前请求的阶段耗时；普通请求不保存计时状态。 */
final class ArticleMetricTiming {
    private static final ThreadLocal<Sample> CURRENT = new ThreadLocal<>();

    private ArticleMetricTiming() { }

    static void begin() { CURRENT.set(new Sample()); }
    static void begin(boolean jdbc) { CURRENT.set(new Sample(jdbc)); }
    static Sample current() { return CURRENT.get(); }
    static void clear() { CURRENT.remove(); }
    static boolean active() { return CURRENT.get() != null; }

    static void validation(long nanos) { if (active()) CURRENT.get().validation += nanos; }
    static void lookup(long nanos) { if (active()) CURRENT.get().lookup += nanos; }
    static void transaction(long nanos) { if (active()) CURRENT.get().transaction += nanos; }
    static void fact(long nanos) { if (active()) CURRENT.get().fact += nanos; }
    static void outbox(long nanos) { if (active()) CURRENT.get().outbox += nanos; }
    static void connectionAcquire(long nanos) { if (active()) CURRENT.get().connectionAcquire += nanos; }
    static long connectionAcquireNanos() { return active() ? CURRENT.get().connectionAcquire : 0; }

    static void observeCommit() {
        if (!active() || !TransactionSynchronizationManager.isSynchronizationActive()) return;
        Sample sample = CURRENT.get();
        // beforeCommit 到 afterCommit 覆盖 JDBC COMMIT 与事务回调开销，属于近似值。
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            private long before;
            @Override public void beforeCommit(boolean readOnly) { before = System.nanoTime(); }
            @Override public void afterCommit() { sample.commit += System.nanoTime() - before; }
        });
    }

    static String serverTiming(long preControllerNanos, long controllerNanos,
                               long preControllerAcquireNanos) {
        Sample s = CURRENT.get();
        String base = String.format(Locale.ROOT,
                "preController;dur=%.3f, dbAcquirePre;dur=%.3f, dbAcquireController;dur=%.3f, validation;dur=%.3f, lookup;dur=%.3f, fact;dur=%.3f, outbox;dur=%.3f, commitApprox;dur=%.3f, transaction;dur=%.3f, controller;dur=%.3f",
                ms(preControllerNanos), ms(preControllerAcquireNanos),
                ms(s.connectionAcquire - preControllerAcquireNanos), ms(s.validation), ms(s.lookup),
                ms(s.fact), ms(s.outbox), ms(s.commit), ms(s.transaction), ms(controllerNanos));
        if (s.tomcatPreFilter != null) base += ", tomcatPreFilter;dur="
                + Math.round(s.tomcatPreFilter / 1_000.0) / 1_000.0;
        if (!s.jdbcEnabled) return base;
        var header = new StringBuilder(base);
        s.jdbcDurations().forEach((name, nanos) -> header.append(", ").append(name).append(";dur=")
                .append(Math.round(nanos / 1_000.0) / 1_000.0));
        return header.toString();
    }

    static String countsHeader() {
        Sample s = CURRENT.get();
        if (s == null || !s.jdbcEnabled) return null;
        return "{\"borrowed\":" + s.borrowed + ",\"closed\":" + s.closed
                + ",\"accountLoans\":" + s.accountLoans + ",\"articleLoans\":" + s.articleLoans
                + ",\"writeLoans\":" + s.writeLoans + ",\"otherLoans\":" + s.otherLoans
                + ",\"sqlCalls\":" + s.sqlCalls + ",\"sqlFailures\":" + s.sqlFailures
                + ",\"commitCalls\":" + s.commitCalls + ",\"commitFailures\":" + s.commitFailures
                + ",\"rollbackCalls\":" + s.rollbackCalls + ",\"closeFailures\":" + s.closeFailures + "}";
    }

    private static double ms(long nanos) { return nanos / 1_000_000.0; }

    enum SqlKind { ACCOUNT, ARTICLE, FACT, OUTBOX, OTHER }
    enum LeaseKind { ACCOUNT, ARTICLE, WRITE, OTHER }

    static final class Sample {
        final boolean jdbcEnabled;
        Long tomcatPreFilter;
        Sample() { this(false); }
        Sample(boolean jdbcEnabled) { this.jdbcEnabled = jdbcEnabled; }
        long validation;
        long lookup;
        long fact;
        long outbox;
        long connectionAcquire;
        long commit;
        long transaction;
        long hold, holdAccount, holdArticle, holdWrite, holdOther;
        long prepare, execute, executeAccount, executeArticle, executeFact, executeOutbox, executeOther;
        long read, jdbcCommit, jdbcRollback, close;
        int borrowed, closed, accountLoans, articleLoans, writeLoans, otherLoans;
        int sqlCalls, sqlFailures, commitCalls, commitFailures, rollbackCalls, closeFailures;

        void leaseClosed(LeaseKind kind, long nanos) {
            closed++;
            hold += nanos;
            switch (kind) {
                case ACCOUNT -> { holdAccount += nanos; accountLoans++; }
                case ARTICLE -> { holdArticle += nanos; articleLoans++; }
                case WRITE -> { holdWrite += nanos; writeLoans++; }
                case OTHER -> { holdOther += nanos; otherLoans++; }
            }
        }

        void executed(SqlKind kind, long nanos, boolean failed) {
            sqlCalls++;
            if (failed) sqlFailures++;
            execute += nanos;
            switch (kind) {
                case ACCOUNT -> executeAccount += nanos;
                case ARTICLE -> executeArticle += nanos;
                case FACT -> executeFact += nanos;
                case OUTBOX -> executeOutbox += nanos;
                case OTHER -> executeOther += nanos;
            }
        }

        Map<String, Long> jdbcDurations() {
            var values = new LinkedHashMap<String, Long>();
            values.put("dbHold", hold);
            values.put("dbHoldAccount", holdAccount);
            values.put("dbHoldArticle", holdArticle);
            values.put("dbHoldWrite", holdWrite);
            values.put("dbHoldOther", holdOther);
            values.put("jdbcPrepare", prepare);
            values.put("jdbcExecute", execute);
            values.put("jdbcAccount", executeAccount);
            values.put("jdbcArticle", executeArticle);
            values.put("jdbcFact", executeFact);
            values.put("jdbcOutbox", executeOutbox);
            values.put("jdbcOther", executeOther);
            values.put("jdbcRead", read);
            values.put("jdbcCommit", jdbcCommit);
            values.put("jdbcRollback", jdbcRollback);
            values.put("dbClose", close);
            values.put("dbHoldOtherWork", Math.max(0, hold - prepare - execute - read - jdbcCommit - jdbcRollback - close));
            return values;
        }
    }
}

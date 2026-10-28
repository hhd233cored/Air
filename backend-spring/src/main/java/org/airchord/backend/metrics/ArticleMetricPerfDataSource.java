package org.airchord.backend.metrics;

import org.springframework.jdbc.datasource.DelegatingDataSource;

import javax.sql.DataSource;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/** 仅压测开启：在 Hikari 借出/归还边界测租用时间，不记录 SQL 文本或绑定参数。 */
final class ArticleMetricPerfDataSource extends DelegatingDataSource implements AutoCloseable {
    private static final Pattern USERS = Pattern.compile("(?i)\\busers\\b");
    private static final Pattern ARTICLES = Pattern.compile("(?i)\\bcontent_items\\b");
    private static final Pattern FACTS = Pattern.compile("(?i)\\b(article_view_events|article_likes)\\b");
    private static final Pattern OUTBOX = Pattern.compile("(?i)\\barticle_metric_outbox\\b");

    ArticleMetricPerfDataSource(DataSource delegate) { super(delegate); }

    @Override public Connection getConnection() throws SQLException { return instrument(super.getConnection()); }
    @Override public Connection getConnection(String username, String password) throws SQLException {
        return instrument(super.getConnection(username, password));
    }

    private Connection instrument(Connection connection) {
        var sample = ArticleMetricTiming.current();
        if (sample == null || !sample.jdbcEnabled) {
            var mark = ArticleMetricPublisherTiming.currentMarkJdbc();
            return mark == null ? connection : ArticleMetricPublisherMarkJdbc.instrument(connection, mark);
        }
        long borrowedAt = System.nanoTime();
        sample.borrowed++;
        var closed = new AtomicBoolean();
        var lease = new ArticleMetricTiming.LeaseKind[]{null};
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[]{Connection.class},
                (proxy, method, args) -> {
                    String name = method.getName();
                    if (objectMethod(method)) return objectCall(proxy, connection, method, args);
                    if (name.equals("unwrap") && ((Class<?>) args[0]).isInstance(proxy)) return proxy;
                    if (name.equals("isWrapperFor") && ((Class<?>) args[0]).isInstance(proxy)) return true;
                    if (name.equals("close") && !closed.get()) {
                        long started = System.nanoTime();
                        try {
                            Object value = call(connection, method, args);
                            if (closed.compareAndSet(false, true)) sample.leaseClosed(
                                    lease[0] == null ? ArticleMetricTiming.LeaseKind.OTHER : lease[0],
                                    System.nanoTime() - borrowedAt);
                            return value;
                        } catch (Throwable ex) { sample.closeFailures++; throw ex; }
                        finally { sample.close += System.nanoTime() - started; }
                    }
                    if (name.equals("commit") || name.equals("rollback")) {
                        long started = System.nanoTime();
                        boolean commit = name.equals("commit");
                        if (commit) sample.commitCalls++; else sample.rollbackCalls++;
                        try { return call(connection, method, args); }
                        catch (Throwable ex) { if (commit) sample.commitFailures++; throw ex; }
                        finally {
                            if (commit) sample.jdbcCommit += System.nanoTime() - started;
                            else sample.jdbcRollback += System.nanoTime() - started;
                        }
                    }
                    if (name.equals("prepareStatement") || name.equals("prepareCall") || name.equals("createStatement")) {
                        String sql = args != null && args.length > 0 && args[0] instanceof String text ? text : null;
                        long started = System.nanoTime();
                        Statement statement;
                        try { statement = (Statement) call(connection, method, args); }
                        finally { sample.prepare += System.nanoTime() - started; }
                        return statement(statement, (Connection) proxy, sample, lease, sql);
                    }
                    return call(connection, method, args);
                });
    }

    private static Statement statement(Statement delegate, Connection connection, ArticleMetricTiming.Sample sample,
                                       ArticleMetricTiming.LeaseKind[] lease, String preparedSql) {
        Class<?> type = delegate instanceof CallableStatement ? CallableStatement.class
                : delegate instanceof PreparedStatement ? PreparedStatement.class : Statement.class;
        return (Statement) Proxy.newProxyInstance(Statement.class.getClassLoader(), new Class<?>[]{type},
                (proxy, method, args) -> {
                    String name = method.getName();
                    if (objectMethod(method)) return objectCall(proxy, delegate, method, args);
                    if (name.equals("unwrap") && ((Class<?>) args[0]).isInstance(proxy)) return proxy;
                    if (name.equals("isWrapperFor") && ((Class<?>) args[0]).isInstance(proxy)) return true;
                    if (name.equals("getConnection")) return connection;
                    Object result;
                    if (name.startsWith("execute")) {
                        String sql = preparedSql != null ? preparedSql
                                : args != null && args.length > 0 && args[0] instanceof String text ? text : null;
                        var kind = classify(sql);
                        if (lease[0] == null) lease[0] = switch (kind) {
                            case ACCOUNT -> ArticleMetricTiming.LeaseKind.ACCOUNT;
                            case ARTICLE -> ArticleMetricTiming.LeaseKind.ARTICLE;
                            case FACT, OUTBOX -> ArticleMetricTiming.LeaseKind.WRITE;
                            case OTHER -> ArticleMetricTiming.LeaseKind.OTHER;
                        };
                        long started = System.nanoTime();
                        boolean failed = true;
                        try { result = call(delegate, method, args); failed = false; }
                        finally { sample.executed(kind, System.nanoTime() - started, failed); }
                    } else result = call(delegate, method, args);
                    return result instanceof ResultSet rows ? rows(rows, (Statement) proxy, sample) : result;
                });
    }

    private static ResultSet rows(ResultSet delegate, Statement statement, ArticleMetricTiming.Sample sample) {
        return (ResultSet) Proxy.newProxyInstance(ResultSet.class.getClassLoader(), new Class<?>[]{ResultSet.class},
                (proxy, method, args) -> {
                    String name = method.getName();
                    if (objectMethod(method)) return objectCall(proxy, delegate, method, args);
                    if (name.equals("unwrap") && ((Class<?>) args[0]).isInstance(proxy)) return proxy;
                    if (name.equals("isWrapperFor") && ((Class<?>) args[0]).isInstance(proxy)) return true;
                    if (name.equals("getStatement")) return statement;
                    if (name.equals("next") || name.startsWith("get")) {
                        long started = System.nanoTime();
                        try { return call(delegate, method, args); }
                        finally { sample.read += System.nanoTime() - started; }
                    }
                    return call(delegate, method, args);
                });
    }

    static ArticleMetricTiming.SqlKind classify(String sql) {
        if (sql == null) return ArticleMetricTiming.SqlKind.OTHER;
        if (OUTBOX.matcher(sql).find()) return ArticleMetricTiming.SqlKind.OUTBOX;
        if (FACTS.matcher(sql).find()) return ArticleMetricTiming.SqlKind.FACT;
        if (ARTICLES.matcher(sql).find()) return ArticleMetricTiming.SqlKind.ARTICLE;
        if (USERS.matcher(sql).find()) return ArticleMetricTiming.SqlKind.ACCOUNT;
        return ArticleMetricTiming.SqlKind.OTHER;
    }

    private static Object call(Object delegate, Method method, Object[] args) throws Throwable {
        try { return method.invoke(delegate, args); }
        catch (InvocationTargetException ex) { throw ex.getCause(); }
    }
    private static boolean objectMethod(Method method) { return method.getDeclaringClass() == Object.class; }
    private static Object objectCall(Object proxy, Object delegate, Method method, Object[] args) throws Throwable {
        return switch (method.getName()) {
            case "equals" -> proxy == args[0];
            case "hashCode" -> System.identityHashCode(proxy);
            default -> call(delegate, method, args);
        };
    }
    @Override public void close() throws Exception {
        if (getTargetDataSource() instanceof AutoCloseable closeable) closeable.close();
    }
}

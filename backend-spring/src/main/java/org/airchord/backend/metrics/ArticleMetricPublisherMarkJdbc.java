package org.airchord.backend.metrics;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Perf-only mark JDBC timings. Does not retain SQL text, IDs, parameters or result bodies. */
final class ArticleMetricPublisherMarkJdbc {
    private ArticleMetricPublisherMarkJdbc() { }
    static Connection instrument(Connection raw, ArticleMetricPublisherTiming.MarkJdbc sample) {
        long borrowedAt = System.nanoTime(); sample.borrowed++;
        sample.backendPid = backendPid(raw);
        var closed = new AtomicBoolean();
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[]{Connection.class},
                (proxy, method, args) -> {
                    String name = method.getName();
                    if (identity(proxy, method, args)) return identityValue(proxy, raw, method, args);
                    if (name.equals("close") && !closed.get()) {
                        long started = System.nanoTime();
                        try {
                            Object result = call(raw, method, args);
                            if (closed.compareAndSet(false, true)) { sample.closed++; sample.hold += System.nanoTime() - borrowedAt; }
                            return result;
                        } catch (Throwable ex) { sample.closeFailures++; throw ex; }
                        finally { sample.close += System.nanoTime() - started; }
                    }
                    if (name.equals("commit") || name.equals("rollback")) {
                        boolean commit = name.equals("commit"); long started = System.nanoTime();
                        if (commit && sample.commitStartedAtEpochMs == 0) sample.commitStartedAtEpochMs = System.currentTimeMillis();
                        if (commit) sample.commitCalls++; else sample.rollbackCalls++;
                        try { return call(raw, method, args); }
                        catch (Throwable ex) { if (commit) sample.commitFailures++; else sample.rollbackFailures++; throw ex; }
                        finally { if (commit) { sample.commit += System.nanoTime() - started; sample.commitEndedAtEpochMs = System.currentTimeMillis(); }
                            else sample.rollback += System.nanoTime() - started; }
                    }
                    if (name.equals("prepareStatement") || name.equals("prepareCall") || name.equals("createStatement")) {
                        long started = System.nanoTime(); sample.prepareCalls++;
                        Statement statement;
                        try { statement = (Statement) call(raw, method, args); }
                        catch (Throwable ex) { sample.prepareFailures++; throw ex; }
                        finally { sample.prepare += System.nanoTime() - started; }
                        return statement(statement, (Connection) proxy, sample);
                    }
                    return call(raw, method, args);
                });
    }
    // Driver is a runtime dependency. Reading its cached backend PID issues no SQL.
    // Missing support must not turn optional diagnostics into a business failure.
    private static int backendPid(Connection raw) {
        try {
            Class<?> pg = Class.forName("org.postgresql.PGConnection");
            if (!raw.isWrapperFor(pg)) return 0;
            return ((Number) pg.getMethod("getBackendPID").invoke(raw.unwrap(pg))).intValue();
        } catch (ReflectiveOperationException | SQLException | RuntimeException ignored) {
            return 0;
        }
    }
    private static Statement statement(Statement raw, Connection connection, ArticleMetricPublisherTiming.MarkJdbc sample) {
        Class<?> type = raw instanceof CallableStatement ? CallableStatement.class
                : raw instanceof PreparedStatement ? PreparedStatement.class : Statement.class;
        return (Statement) Proxy.newProxyInstance(Statement.class.getClassLoader(), new Class<?>[]{type},
                (proxy, method, args) -> {
                    String name = method.getName();
                    if (identity(proxy, method, args)) return identityValue(proxy, raw, method, args);
                    if (name.equals("getConnection")) return connection;
                    if (name.startsWith("execute")) {
                        try {
                            if (raw.isWrapperFor(org.postgresql.PGStatement.class))
                                sample.serverPrepareThreshold = raw.unwrap(org.postgresql.PGStatement.class).getPrepareThreshold();
                        } catch (SQLException ignored) { sample.serverPrepareThreshold = -1; }
                        long started = System.nanoTime(); sample.executeCalls++;
                        if (sample.executeStartedAtEpochMs == 0) sample.executeStartedAtEpochMs = System.currentTimeMillis();
                        try {
                            Object value = call(raw, method, args);
                            if ((name.equals("executeUpdate") || name.equals("executeLargeUpdate")) && value instanceof Number rows)
                                sample.updatedRows += rows.intValue();
                            return value;
                        } catch (Throwable ex) { sample.executeFailures++; throw ex; }
                        finally { sample.execute += System.nanoTime() - started; sample.executeEndedAtEpochMs = System.currentTimeMillis(); }
                    }
                    return call(raw, method, args);
                });
    }
    private static boolean identity(Object proxy, Method method, Object[] args) {
        return method.getDeclaringClass() == Object.class ||
                ((method.getName().equals("unwrap") || method.getName().equals("isWrapperFor")) && ((Class<?>) args[0]).isInstance(proxy));
    }
    private static Object identityValue(Object proxy, Object raw, Method method, Object[] args) throws Throwable {
        return switch (method.getName()) {
            case "equals" -> proxy == args[0]; case "hashCode" -> System.identityHashCode(proxy);
            case "unwrap" -> proxy; case "isWrapperFor" -> true; default -> call(raw, method, args);
        };
    }
    private static Object call(Object raw, Method method, Object[] args) throws Throwable {
        try { return method.invoke(raw, args); }
        catch (InvocationTargetException ex) { throw ex.getCause(); }
    }
}

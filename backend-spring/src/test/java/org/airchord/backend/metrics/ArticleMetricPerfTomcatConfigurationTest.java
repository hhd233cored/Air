package org.airchord.backend.metrics;

import org.junit.jupiter.api.Test;
import org.apache.catalina.Valve;
import org.apache.catalina.connector.Request;
import org.apache.catalina.connector.Response;
import static org.mockito.Mockito.*;

class ArticleMetricPerfTomcatConfigurationTest {
    @Test void valveCopiesOnlyMarkedRequestStartAndPreservesChain() throws Exception {
        var request = mock(Request.class);
        var response = mock(Response.class);
        var coyote = new org.apache.coyote.Request();
        coyote.markStartTime();
        when(request.getCoyoteRequest()).thenReturn(coyote);
        when(request.getHeader("X-Perf-Timing")).thenReturn("1");
        var next = mock(Valve.class);
        var valve = new ArticleMetricPerfTomcatConfiguration.TimingValve();
        valve.setNext(next);
        valve.invoke(request,response);
        verify(request).setAttribute(ArticleMetricPerfTomcatConfiguration.PARSE_START,coyote.getStartTimeNanos());
        verify(next).invoke(request,response);
        var ordinary = mock(Request.class);
        valve.invoke(ordinary,response);
        verify(ordinary,never()).getCoyoteRequest();
        verify(next).invoke(ordinary,response);
    }
}

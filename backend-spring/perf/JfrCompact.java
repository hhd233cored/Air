import java.io.*;
import java.nio.file.*;
import java.util.*;
import jdk.jfr.consumer.*;

/** Only local experiment recordings; emit selected values and method names, never environment or object contents. */
class JfrCompact {
    static final Set<String> TYPES = Set.of("jdk.GarbageCollection","jdk.GCPhasePause","jdk.SafepointBegin","jdk.SafepointEnd",
        "jdk.CPULoad","jdk.ThreadCPULoad","jdk.ThreadPark","jdk.JavaMonitorEnter","jdk.SocketRead","jdk.SocketWrite");
    static String quote(String value) {
        if(value==null)return "null";
        var b=new StringBuilder("\"");
        for(char c:value.toCharArray())switch(c){
            case '"' -> b.append("\\\""); case '\\' -> b.append("\\\\");
            case '\n' -> b.append("\\n");case '\r' -> b.append("\\r");case '\t' -> b.append("\\t");
            default -> {if(c<32)b.append(String.format("\\u%04x",(int)c));else b.append(c);}
        }
        return b.append('"').toString();
    }
    public static void main(String[] args)throws Exception {
        long raw=0,selected=0,filteredParks=0;
        try(var file=new RecordingFile(Path.of(args[0]));var out=new BufferedWriter(new OutputStreamWriter(System.out,java.nio.charset.StandardCharsets.UTF_8))){
            while(file.hasMoreEvents()){
                var e=file.readEvent();raw++;String type=e.getEventType().getName();if(!TYPES.contains(type))continue;
                var trace=e.getStackTrace();var stack=new ArrayList<String>();
                if(trace!=null)for(var f:trace.getFrames())stack.add(f.getMethod().getType().getName().replace('/','.')+"."+f.getMethod().getName());
                boolean hikari=stack.contains("com.zaxxer.hikari.pool.HikariPool.getConnection");
                if(type.equals("jdk.ThreadPark")&&!hikari){filteredParks++;continue;}
                boolean postgres=stack.stream().anyMatch(s->s.startsWith("org.postgresql."));
                String role=hikari?"hikariPark":stack.contains("org.postgresql.jdbc.PgConnection.commit")?"commitSocket":postgres?"postgresSocket":"other";
                String thread=e.hasField("eventThread")&&e.getThread("eventThread")!=null?e.getThread("eventThread").getJavaName():null;
                var line=new StringBuilder("{\"type\":").append(quote(type)).append(",\"startTime\":").append(quote(e.getStartTime().toString()))
                    .append(",\"duration\":").append(quote(e.getDuration().toString())).append(",\"thread\":").append(quote(thread))
                    .append(",\"role\":").append(quote(role)).append(",\"stackTruncated\":").append(trace!=null&&(trace.isTruncated()||stack.size()>32)).append(",\"stack\":[");
                for(int i=0;i<Math.min(32,stack.size());i++){if(i>0)line.append(',');line.append(quote(stack.get(i)));}
                line.append(']');
                for(String key:List.of("name","cause","sumOfPauses"))if(e.hasField(key))line.append(',').append(quote(key)).append(':').append(quote(String.valueOf((Object)e.getValue(key))));
                for(String key:List.of("jvmUser","jvmSystem","machineTotal","gcId"))if(e.hasField(key))line.append(',').append(quote(key)).append(':').append(String.valueOf((Object)e.getValue(key)));
                out.write(line.append('}').toString());out.newLine();selected++;
            }
        }
        System.err.println("JFR rawEvents="+raw+" selectedEvents="+selected+" filteredIdleParks="+filteredParks);
    }
}

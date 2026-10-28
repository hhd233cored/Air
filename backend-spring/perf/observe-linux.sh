#!/bin/sh
# /proc is WSL VM-wide; cgroup is this PostgreSQL container. No process arguments.
while true; do
 printf 'time '; date +%s%3N
 head -n 1 /proc/stat
 for kind in cpu io memory; do sed "s/^/psi-$kind /" /proc/pressure/$kind; done
 sed 's/^/disk /' /proc/diskstats
 sed 's/^/cg-cpu /' /sys/fs/cgroup/cpu.stat
 sed 's/^/cg-io /' /sys/fs/cgroup/io.stat
 printf 'cg-memory '; cat /sys/fs/cgroup/memory.current
 sed -n '/MemAvailable:/p' /proc/meminfo
 sleep 0.25
done

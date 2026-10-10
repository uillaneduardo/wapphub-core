#!/bin/sh
set -eu
# Kernel lock is held across the entire node process and released on crashes.
# Never unlink this inode or steal a stale timestamp lock.
exec flock --no-fork --nonblock --conflict-exit-code 73 /data/.writer.lock env PROVIDER_WRITER_LOCK=held node dist/services/wapphub-provider-web/src/main.js

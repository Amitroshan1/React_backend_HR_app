# Attendance SSE (Phase 3D) — nginx notes

SSE endpoint: `GET /api/attendance/events`

## Required / recommended nginx settings

When nginx proxies Flask/Gunicorn, disable buffering for this path so keep-alives reach the browser:

```nginx
location /api/attendance/events {
    proxy_pass http://backend_upstream;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    add_header X-Accel-Buffering no;
}
```

`EventSource` cannot send `Authorization` headers; the client passes `?access_token=<JWT>` (HTTPS only).

## Gunicorn

- Sync workers support SSE streams (one worker greenlet/thread occupied per connection).
- Prefer a modest worker count; long-lived SSE does not need Redis for this release.
- Cross-worker delivery uses the `attendance_realtime_events` outbox table (indexed `id` cursor), not shared memory.
- Optional later: Redis pub/sub if connection volume grows.

## Failure isolation

SSE publish failures never roll back Punch / PunchSession / biometric_logs writes.

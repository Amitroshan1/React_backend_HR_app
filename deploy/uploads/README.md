# Shared uploads root (optional)

When `PROVISION_UPLOADS_ROOT` points here, provision creates:

```text
uploads/{slug}/
```

Each customer instance should set its own `UPLOADS_ROOT` in that
customer `.env` (often the same path, or a path under that instance).

Do not commit uploaded files.

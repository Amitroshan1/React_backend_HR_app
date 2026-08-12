# Secure uploads — production deploy notes

Private HRMS files (profile photos, KYC, payslips, Form 16, expenses, NOC, policies, etc.)
must **not** be served anonymously from disk.

## What the app does

1. Flask route `/static/uploads/<path>` requires JWT **or** a short-lived `?exp=&sig=` signature.
2. APIs return signed URLs for photos (`/api/files/signed/...`).
3. Downloads use `/api/files/content/...` or existing `/api/accounts/file/...` with `Authorization: Bearer`.
4. New profile photos / payslips / Form 16 / KYC filenames include a random UUID segment.

## Critical nginx change

If nginx currently serves files directly from `website/static/uploads`, **anonymous 200s will continue**.
Proxy that path to Flask (or deny it):

```nginx
# Option A (recommended): proxy uploads to Flask for auth
location /static/uploads/ {
    proxy_pass http://127.0.0.1:5000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $http_authorization;
}

# Keep other static assets public if needed
location /static/ {
    alias /path/to/backend_HRMS/website/static/;
}
```

Or deny direct disk access and only allow API:

```nginx
location /static/uploads/ {
    deny all;
    return 404;
}
```

Also ensure `backend_HRMS/uploads/` (payslips/form16) is **never** aliased as a public URL.

## Env

```env
UPLOADS_ROOT=/var/hrms/private_uploads   # optional absolute private root
FILE_SIGN_TTL_SECONDS=3600               # signed img/email link lifetime
SECRET_KEY=...                           # used for HMAC signatures
JWT_SECRET_KEY=...
```

## Smoke test after deploy

1. Logged out: `curl -I https://yoursite/static/uploads/profile_1_10202.png` → **401/403/404** (not 200 with body).
2. Logged in app: avatar and payslip download still work.
3. Payslip: employee can open own slip via Payslip page; other employee path → 403.

## Rollback

Remove the `/static/uploads/` Flask route override and nginx proxy deny; redeploy previous frontend if needed.
Existing files on disk are not moved — dual-read still finds them under `static/uploads` and `UPLOADS_ROOT`.

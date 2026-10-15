# Go live (pull this repo and run in production)

This machine (Cursor) is for development only. **You** pull the code onto the
live server and turn the live switches on there. The app starts without Redis;
Redis / gunicorn / the job worker make production faster and safer under load.

## 1. On the live server

```bash
cd /path/to/React_backend_HR_app
git pull

cd backend_HRMS
# Keep your existing .env secrets. Merge new keys from .env.example if missing.
python -m venv .venv          # or activate the existing venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

```bash
cd ../frontend
npm ci
npm run build
# Point nginx (or your static host) at frontend/dist
# Proxy /api and /static/uploads to gunicorn (do not serve uploads from nginx alone)
```

## 2. Live `.env` (backend_HRMS/.env)

Keep `SECRET_KEY`, `JWT_SECRET_KEY`, `DATABASE_URI`, Zepto/mail, `BASE_URL`, `CORS_ORIGINS`.

Add or set:

| Key | Live value | Why |
|-----|------------|-----|
| `API_PAGINATION_V1` | `1` | Phase 4 server paging |
| `CACHE_REDIS_URL` | `redis://127.0.0.1:6379/0` | Shared cache + rate limits across workers |
| `RATE_LIMIT_BACKEND` | `auto` | Uses Redis when URL is set |
| `BACKGROUND_JOBS` | `1` | Optional `async=1` on heavy endpoints |
| `GUNICORN_WORKERS` | `5` (tune to CPU) | Multi-process web |
| `GUNICORN_THREADS` | `2` | |
| `VERIFY_OTP_IP_LIMIT_PER_HOUR` | `0` | Unlimited OTP verify (or set e.g. `30`) |
| `UPLOADS_ROOT` | absolute path | Payslips / job exports |
| `SHOW_DEPLOYMENT_GUIDE` | `0` | Customer instances |

If Redis is not installed yet, **omit** `CACHE_REDIS_URL`. The app still runs;
workers will not share cache/rate counters until Redis is added.

## 3. Start services

```bash
# Redis (recommended once under real traffic)
# sudo systemctl enable --now redis

cd backend_HRMS
source .venv/bin/activate
gunicorn -c gunicorn.conf.py wsgi:app

# Optional dedicated job worker (APScheduler also flushes pending jobs every minute)
# BACKGROUND_JOBS=1 flask jobs-worker
```

Frontend: serve `frontend/dist` with nginx; reverse-proxy `/api` → gunicorn.

## 4. Smoke check after go-live

1. Login (OTP).
2. Admin → Employees (paged list).
3. IT → Inventory overview / Total assets.
4. HR → Leave application updation.
5. Admin → Approval settings (toggles default on).
6. Optional: `GET /api/accounts/compliance/pf-ecr?...&async=1` then poll `/api/jobs/<id>`.

## 5. Localhost (this laptop)

- Use `python app.py` + `npm run dev` (Vite proxies `/api`).
- Do **not** set `CACHE_REDIS_URL` unless you run Redis locally.
- `BACKGROUND_JOBS=0` is fine locally; leave endpoints stay synchronous.

Code path is the same as live; only `.env` and how you start the process differ.

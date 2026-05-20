# New customer deployment checklist

One **dedicated instance** per customer company (separate server, database, and environment). Same codebase as Solviotec; different configuration only.

## Before you start

- [ ] Customer name and plan agreed (Basic / Essential / Enterprise)
- [ ] Domain or subdomain decided (e.g. `hr.acme.com`)
- [ ] Server or VPS provisioned (Linux recommended)
- [ ] MySQL database created (empty)
- [ ] SSL certificate planned (Let's Encrypt or customer cert)

---

## 1. Server preparation

- [ ] Install: Python 3.11+, Node 18+ (build frontend), MySQL, Nginx, Git
- [ ] Create app user (e.g. `hrms`) and deploy directory (e.g. `/var/www/hrms`)
- [ ] Clone or copy the **same repository** tag/release used for production
- [ ] Open firewall: 80, 443 (and 22 for SSH only from trusted IPs)

---

## 2. Database

- [ ] Create database: `hrms_acme` (unique per customer)
- [ ] Create DB user with access only to that database
- [ ] Run migrations / schema setup on **this** database only
- [ ] Verify no connection string points to another customer's DB

---

## 3. Backend environment (`.env` in `backend_HRMS/`)

Copy from your master template and set **customer-specific** values:

| Variable | Example | Notes |
|----------|---------|--------|
| `DATABASE_URI` | `mysql+pymysql://user:pass@localhost/hrms_acme` | Unique per customer |
| `SECRET_KEY` | (new random string) | **Never reuse** across customers |
| `JWT_SECRET_KEY` | (new random string) | **Never reuse** |
| `BASE_URL` | `https://hr.acme.com` | Customer login URL |
| `CORS_ORIGINS` | `https://hr.acme.com` | Match frontend origin |
| `EMAIL_HR` / `EMAIL_IT` / etc. | Customer addresses | Per-company mail routing |
| `ZEPTO_*` | Customer or shared mail API | As per contract |
| `UPLOADS_ROOT` | `/var/www/hrms/uploads` | Isolated folder on this server |
| `SHOW_DEPLOYMENT_GUIDE` | `0` | **Off** on customer instances (vendor only) |

- [ ] Create Python venv, `pip install -r requirements.txt`
- [ ] Test: `flask run` or gunicorn binds locally
- [ ] Configure gunicorn/systemd service for backend

---

## 4. Frontend build

- [ ] In `frontend/`: `npm install` && `npm run build`
- [ ] Serve `dist/` via Nginx (or copy to static path)
- [ ] Nginx proxies `/api/*` to backend (e.g. port 5000)
- [ ] Force HTTPS redirect

---

## 5. First-time application setup

- [ ] Start backend; confirm health (login page loads)
- [ ] Log in as vendor-created **first HR / Super Admin** (or use existing seed user)
- [ ] HR: Add **departments** and **circles** (master data) for this company
- [ ] HR: Add **holiday calendar** for current year
- [ ] HR: Create first employees or import process
- [ ] Send password-set emails from HR module
- [ ] Smoke test: punch, leave apply, payslip path (per plan)

---

## 6. Plan-specific features (configure later in code or env)

| Plan | Typical limits (define in contract) |
|------|-------------------------------------|
| Basic | Core HR, attendance, leave |
| Essential | + Payroll, IT module, performance |
| Enterprise | + Custom domain, SLA, dedicated support |

Document enabled modules in your internal runbook for this customer.

---

## 7. Handover to customer

- [ ] Send login URL and admin credentials (secure channel)
- [ ] Short user guide / training date
- [ ] Support contact and escalation
- [ ] Backup schedule documented (daily DB dump minimum)

---

## 8. Ongoing operations (your team)

- [ ] Add instance to **release checklist** (deploy same version to all servers)
- [ ] Monitor disk (uploads), DB size, SSL expiry
- [ ] Keep list of instances: name, URL, DB name, plan, go-live date

---

## Rollback

- [ ] DB backup taken **before** each production deploy
- [ ] Previous release tag noted in change log

---

## Do not

- Do not point multiple customers at one database
- Do not copy production `.env` between servers without changing secrets
- Do not enable `SHOW_DEPLOYMENT_GUIDE` on customer-facing instances

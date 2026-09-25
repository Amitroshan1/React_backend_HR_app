# Customer instance template

Use the company **slug** from Admin → Customers (e.g. `acme_corp`).

## Windows (PowerShell) — from repo root

```powershell
$slug = "acme_corp"   # change me
$root = Get-Location
$dest = Join-Path $root "deploy\customers\$slug"

# Option A: clone same repo (clean)
git clone --depth 1 <YOUR_REPO_URL> "$dest\React_backend_HR_app"

# Option B: copy working tree without venv/node_modules (adjust as needed)
# robocopy $root "$dest\React_backend_HR_app" /E /XD .git myenv .venv node_modules deploy\customers

# Install generated env (from Admin download or artifacts)
Copy-Item "deploy\artifacts\$slug\.env" `
  "$dest\React_backend_HR_app\backend_HRMS\.env"

# Backend
cd "$dest\React_backend_HR_app\backend_HRMS"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# run gunicorn/flask on a unique port, e.g. 5001
```

## Linux

```bash
SLUG=acme_corp
mkdir -p /var/hrms/customers/$SLUG
git clone --depth 1 <YOUR_REPO_URL> /var/hrms/customers/$SLUG/React_backend_HR_app
cp /var/hrms/artifacts/$SLUG/.env \
  /var/hrms/customers/$SLUG/React_backend_HR_app/backend_HRMS/.env
```

## Important

- Live file name is always `backend_HRMS/.env` (not `acme_corp.env`).
- Set `SHOW_DEPLOYMENT_GUIDE=0` in that file (Provision already does).
- Use a **different port** or reverse-proxy host per customer.

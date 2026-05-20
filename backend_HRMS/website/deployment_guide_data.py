"""Structured new-customer deployment checklist (one instance per company)."""

DEPLOYMENT_GUIDE = {
    "title": "New customer deployment",
    "subtitle": "Deploy a separate server and database for each company. Same codebase, isolated environment.",
    "model": "dedicated_instance",
    "sections": [
        {
            "id": "prep",
            "title": "Before you start",
            "items": [
                "Customer name and plan agreed (Basic / Essential / Enterprise)",
                "Domain or subdomain decided (e.g. hr.acme.com)",
                "Server or VPS provisioned",
                "Empty MySQL database created",
                "SSL certificate planned",
            ],
        },
        {
            "id": "server",
            "title": "1. Server preparation",
            "items": [
                "Install Python 3.11+, Node 18+, MySQL, Nginx, Git",
                "Create deploy directory (e.g. /var/www/hrms)",
                "Deploy same release tag as your reference production",
                "Firewall: allow 80, 443; restrict SSH",
            ],
        },
        {
            "id": "database",
            "title": "2. Database",
            "items": [
                "Create unique database (e.g. hrms_acme)",
                "Create DB user with access only to that database",
                "Apply schema / migrations on this database only",
                "Confirm no shared DATABASE_URI with other customers",
            ],
        },
        {
            "id": "backend_env",
            "title": "3. Backend environment (.env)",
            "items": [
                "DATABASE_URI — unique per customer",
                "SECRET_KEY and JWT_SECRET_KEY — new random values per customer",
                "BASE_URL — customer URL (https://hr.customer.com)",
                "CORS_ORIGINS — match frontend origin",
                "EMAIL_HR, EMAIL_IT, ZEPTO_* — customer mail settings",
                "UPLOADS_ROOT — isolated folder on this server",
                "SHOW_DEPLOYMENT_GUIDE=0 on customer instances (vendor master only)",
                "pip install -r requirements.txt; configure gunicorn/systemd",
            ],
        },
        {
            "id": "frontend",
            "title": "4. Frontend build",
            "items": [
                "npm install && npm run build in frontend/",
                "Serve dist/ via Nginx; proxy /api to backend",
                "Enable HTTPS redirect",
            ],
        },
        {
            "id": "app_setup",
            "title": "5. First-time application setup",
            "items": [
                "Verify login page and API health",
                "Configure departments and circles (HR master data)",
                "Seed holiday calendar for current year",
                "Create first HR admin and employees",
                "Smoke test: attendance, leave, modules per plan",
            ],
        },
        {
            "id": "handover",
            "title": "6. Handover to customer",
            "items": [
                "Send login URL and credentials securely",
                "Training / user guide",
                "Support contact documented",
                "Daily database backup scheduled",
            ],
        },
        {
            "id": "ops",
            "title": "7. Ongoing operations",
            "items": [
                "Add instance to release deploy checklist",
                "Track: company name, URL, DB name, plan, go-live date",
                "Monitor SSL expiry, disk, and DB size",
            ],
        },
    ],
    "env_template": [
        {"key": "DATABASE_URI", "hint": "mysql+pymysql://user:pass@localhost/hrms_CUSTOMER"},
        {"key": "SECRET_KEY", "hint": "New random string per customer"},
        {"key": "JWT_SECRET_KEY", "hint": "New random string per customer"},
        {"key": "BASE_URL", "hint": "https://hr.customer.com"},
        {"key": "CORS_ORIGINS", "hint": "https://hr.customer.com"},
        {"key": "SHOW_DEPLOYMENT_GUIDE", "hint": "0 on customer servers; 1 on vendor master only"},
    ],
    "plans": [
        {"id": "basic", "label": "Basic", "notes": "Core HR, attendance, leave"},
        {"id": "essential", "label": "Essential", "notes": "Basic + payroll, IT, performance (as sold)"},
        {"id": "enterprise", "label": "Enterprise", "notes": "Full suite + custom domain / SLA"},
    ],
}

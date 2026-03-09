# HR Management System

A full-stack HR (Human Resource) Management application with a React frontend and Flask backend. It provides role-based access for Employees, HR, Managers, Admin, IT, and Accounts teams.

---

## Project Structure

```
React_backend_HR_app/
├── frontend/                 # React + Vite SPA
│   ├── src/
│   │   ├── App.jsx          # Routes & layout
│   │   ├── components/      # Shared components (Header, AppLayout, UserContext)
│   │   └── pages/           # Page components (Dashboard, HR, Admin, etc.)
│   └── package.json
├── backend_HRMS/             # Flask API server
│   ├── app.py               # App entry point
│   ├── website/
│   │   ├── __init__.py      # App factory, blueprints, scheduler
│   │   ├── auth.py          # Login, JWT, user homepage
│   │   ├── models/          # SQLAlchemy models
│   │   └── [blueprints]/    # leave, Human_resource, query, Admin, etc.
│   └── requirements.txt
└── README.md
```

---

## Application Flow

### 1. Entry & Authentication

```
User visits "/"
    → HomePage (Header + HeroSection)
    → Clicks "Explore" → Login card appears
    → Enters email + password
    → POST /api/auth/validate-user
    → Backend validates credentials
    → Returns JWT token
    → Token stored in localStorage
    → UserContext fetches /api/auth/employee/homepage (user, employee, leave_balance)
    → Redirect to /dashboard
```

### 2. Protected Routes

```
Any route under AppLayout (dashboard, attendance, leaves, etc.)
    → AppLayout checks localStorage.getItem("token")
    → No token → redirect to "/"
    → Token exists → UserContext fetches user data
    → Headers component shows user name, role, profile pic
    → Role-based nav links (HR Panel, Admin, Manager, IT) based on emp_type
    → Outlet renders child route (Dashboard, Attendance, etc.)
```

### 3. Session & Security

- **Inactivity timeout**: 5 minutes; user is logged out if idle
- **Token refresh**: JWT stored in `localStorage`; sent as `Authorization: Bearer <token>` on API calls
- **CORS**: Backend allows configured origins (localhost for dev, production domains)

---

## User Roles & Access

| Role         | Access Areas                                             |
|--------------|-----------------------------------------------------------|
| Employee     | Dashboard, Attendance, Leaves, Payslip, Profile, Queries, Claims, Separation, WFH, Performance, Holiday Calendar |
| Human Resource | HR Panel, archive employees, exit employees, add locations, NOC, etc. |
| Manager      | Manager Panel, leave approvals, team view, performance reviews |
| Admin        | Admin Panel, employee management, leaves, queries, claims, resignations |
| IT           | IT Panel (system status, assets, backups, support tickets, etc.) |
| Account      | Accounts Panel                                           |

---

## API Architecture

The frontend proxies `/api` and `/static` to the Flask backend (default: `http://127.0.0.1:5000`).

| Blueprint   | Prefix                 | Purpose                                      |
|------------|------------------------|-----------------------------------------------|
| auth       | `/api/auth`            | Login, validate-user, employee/homepage, master-options, set-password |
| admin_bp   | `/api/admin`           | Admin operations, employees, leaves, queries, claims, resignations |
| leave      | `/api/leave`           | Leave applications, attendance, punch in/out  |
| hr         | `/api/HumanResource`   | HR operations (locations, NOC, confirmations, holiday calendar, etc.) |
| Accounts   | `/api/accounts`        | Accounts/payslips                             |
| query      | `/api/query`           | Employee queries and replies                  |
| manager    | `/api/manager`         | Manager leave approvals, team, probation      |
| notifications | `/api/notifications` | Notifications                                 |
| performance_api | `/api/performance` | Performance reviews (employee & manager)      |

---

## Data Flow (High Level)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (React)                               │
├─────────────────────────────────────────────────────────────────────────┤
│  HeroSection (Login)  →  AppLayout  →  Protected Pages (Dashboard, etc.) │
│        │                      │                      │                   │
│        └──────────────────────┼──────────────────────┘                   │
│                               │                                          │
│                    UserContext (userData, leave_balance)                  │
│                               │                                          │
│           All API calls: Authorization: Bearer <token>                    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                         Vite proxy /api → :5000
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│                        BACKEND (Flask)                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  JWT validation  →  Blueprint routes  →  SQLAlchemy models  →  DB        │
│                                                                          │
│  APScheduler: Daily jobs at 6:00 AM IST (leave accrual, compoff,         │
│               probation reminders, pending leave reminders)              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Getting Started

### Prerequisites

- Node.js (for frontend)
- Python 3.x (for backend)
- MySQL (or compatible DB for SQLAlchemy)

### Backend Setup

1. Create virtual environment and install dependencies:
   ```bash
   cd backend_HRMS
   python -m venv venv
   venv\Scripts\activate   # Windows
   pip install -r requirements.txt
   ```

2. Create `.env` in `backend_HRMS/` with:
   - `SECRET_KEY` – Flask secret
   - `DATABASE_URI` – e.g. `mysql+pymysql://user:pass@host/dbname`
   - `JWT_SECRET_KEY` – for JWT signing
   - Optional: `BASE_URL`, Zepto email vars, `UPLOADS_ROOT`, `CORS_ORIGINS`

3. Run migrations:
   ```bash
   flask db upgrade
   ```

4. Start the server:
   ```bash
   python app.py
   ```
   Server runs at `http://127.0.0.1:5000`

### Frontend Setup

1. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```

2. Start dev server:
   ```bash
   npm run dev
   ```
   App runs at `http://localhost:5173` with API proxy to backend

### Production Build

```bash
# Frontend
cd frontend && npm run build

# Serve the `frontend/dist` folder (e.g. via nginx) and ensure API/static are proxied to the Flask backend.
```

---

## Main Features

- **Dashboard** – Overview, quick stats, announcements
- **Attendance** – Punch in/out (location-aware), WFH
- **Leaves** – Apply, balance, approvals (Manager/Admin)
- **Payslip** – View payslips (via Accounts)
- **Profile** – Personal info, education, family, previous employment
- **Queries** – Raise queries, department inbox
- **Claims** – Submit and track claims
- **Separation** – Resignation flow
- **Performance** – Self-appraisal, manager reviews
- **Holiday Calendar** – Company holidays
- **HR Panel** – Locations, NOC, confirmation, assets, etc.
- **Admin Panel** – Employee CRUD, leaves, queries, claims, resignations
- **Manager Panel** – Team, approvals, performance reviews
- **IT Panel** – System status, assets, backups, support tickets

---

## Tech Stack

| Layer    | Technologies                          |
|----------|----------------------------------------|
| Frontend | React 19, Vite, React Router, Tailwind, React Toastify |
| Backend  | Flask, SQLAlchemy, Flask-Migrate, JWT, Bcrypt, CORS   |
| DB       | MySQL (via PyMySQL)                    |
| Jobs     | Flask-APScheduler                      |
